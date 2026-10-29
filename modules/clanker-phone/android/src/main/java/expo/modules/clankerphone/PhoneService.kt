package expo.modules.clankerphone

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.RequiresApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// How long the "Done" chip stays up before hiding itself.
private const val DONE_CHIP_MS = 6000L

/**
 * The accessibility service the agent operates the phone through. The user turns it on in the
 * system's accessibility settings; while it runs, `instance` is set and the module can read other
 * apps' screens, act on them and show the overlay.
 */
class PhoneService : AccessibilityService() {
  companion object {
    @Volatile
    var instance: PhoneService? = null
      private set

    /** Called on the main thread when the user taps Stop on the overlay. */
    @Volatile
    var onStop: (() -> Unit)? = null
  }

  private val main = Handler(Looper.getMainLooper())
  @Volatile private var lastEventAt = 0L

  private var overlay: LinearLayout? = null
  private var overlayLabel: TextView? = null
  private var overlayButton: TextView? = null
  private var overlayState = "hidden"
  private val hideDone = Runnable { setOverlay("hidden") }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    lastEventAt = SystemClock.uptimeMillis()
  }

  override fun onInterrupt() {}

  override fun onUnbind(intent: Intent?): Boolean {
    shutDown()
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    shutDown()
    super.onDestroy()
  }

  private fun shutDown() {
    instance = null
    main.post { removeOverlay() }
  }

  /** Waits until the screen has had no window or content changes for `idleMs`, or `timeoutMs` passes. */
  suspend fun awaitIdle(idleMs: Long = 300, timeoutMs: Long = 2500) {
    val start = SystemClock.uptimeMillis()
    // Gives the action's first events time to arrive before quiet can count as settled.
    delay(120)
    while (true) {
      val now = SystemClock.uptimeMillis()
      if (now - lastEventAt >= idleMs || now - start >= timeoutMs) return
      delay(50)
    }
  }

  suspend fun <T> onMain(block: () -> T): T = suspendCancellableCoroutine { cont ->
    main.post {
      try {
        cont.resume(block())
      } catch (e: Throwable) {
        cont.resumeWithException(e)
      }
    }
  }

  /** Real size of the default display in pixels, including the system bars. */
  fun screenSize(): Pair<Int, Int> {
    val wm = getSystemService(WINDOW_SERVICE) as WindowManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = wm.maximumWindowMetrics.bounds
      bounds.width() to bounds.height()
    } else {
      val metrics = android.util.DisplayMetrics()
      @Suppress("DEPRECATION")
      wm.defaultDisplay.getRealMetrics(metrics)
      metrics.widthPixels to metrics.heightPixels
    }
  }

  /** Runs one stroke and resolves with whether it completed. The overlay lets touches through meanwhile. */
  suspend fun gesture(path: Path, durationMs: Long): Boolean {
    onMain { passThrough(true) }
    try {
      return suspendCancellableCoroutine { cont ->
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(1, 60_000))
        val callback = object : GestureResultCallback() {
          override fun onCompleted(gestureDescription: GestureDescription?) {
            if (cont.isActive) cont.resume(true)
          }

          override fun onCancelled(gestureDescription: GestureDescription?) {
            if (cont.isActive) cont.resume(false)
          }
        }
        if (!dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), callback, null) && cont.isActive) {
          cont.resume(false)
        }
      }
    } finally {
      onMain { passThrough(false) }
    }
  }

  @RequiresApi(Build.VERSION_CODES.R)
  suspend fun capture(): Bitmap = suspendCancellableCoroutine { cont ->
    takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
      override fun onSuccess(result: ScreenshotResult) {
        val buffer = result.hardwareBuffer
        val bitmap = Bitmap.wrapHardwareBuffer(buffer, result.colorSpace)?.copy(Bitmap.Config.ARGB_8888, false)
        buffer.close()
        if (bitmap != null) cont.resume(bitmap) else cont.resumeWithException(PhoneException("The screenshot could not be decoded."))
      }

      override fun onFailure(errorCode: Int) {
        cont.resumeWithException(ScreenshotFailure(errorCode))
      }
    })
  }

  /** Opens Clanker itself, e.g. from the overlay's Done chip. */
  fun openSelf() {
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
      startActivity(it)
    }
  }

  fun inForeground() = rootInActiveWindow?.packageName == packageName

  // ---- overlay (main thread only) ---------------------------------------------------------------

  /** "working" shows the Stop pill, "done" the chip back to Clanker, "hidden" nothing. */
  fun setOverlay(state: String) {
    main.removeCallbacks(hideDone)
    val next = if (state == "done" && inForeground()) "hidden" else state
    if (next == "hidden") {
      removeOverlay()
      overlayState = next
      return
    }
    val view = overlay ?: createOverlay()
    if (next == "working") {
      overlayLabel?.text = "Clanker is using your phone"
      overlayButton?.text = "Stop"
      overlayButton?.visibility = View.VISIBLE
    } else {
      overlayLabel?.text = "Done"
      overlayButton?.text = "Back to Clanker"
      main.postDelayed(hideDone, DONE_CHIP_MS)
    }
    view.visibility = View.VISIBLE
    overlayState = next
  }

  /** Hides the overlay without forgetting its state, so a screenshot doesn't show it. */
  fun setOverlayVisible(visible: Boolean) {
    overlay?.visibility = if (visible && overlayState != "hidden") View.VISIBLE else View.INVISIBLE
  }

  private fun passThrough(on: Boolean) {
    val view = overlay ?: return
    val params = view.layoutParams as WindowManager.LayoutParams
    params.flags = if (on) params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    else params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    (getSystemService(WINDOW_SERVICE) as WindowManager).updateViewLayout(view, params)
  }

  private fun dp(value: Int) =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

  private fun createOverlay(): LinearLayout {
    val pill = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(14), dp(6), dp(6), dp(6))
      background = GradientDrawable().apply {
        cornerRadius = dp(20).toFloat()
        setColor(Color.argb(235, 18, 18, 18))
      }
      elevation = dp(6).toFloat()
    }
    val label = TextView(this).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
    }
    val button = TextView(this).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      setPadding(dp(12), dp(6), dp(12), dp(6))
      background = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(Color.argb(255, 60, 60, 60))
      }
      setOnClickListener {
        if (overlayState == "working") {
          setOverlay("hidden")
          onStop?.invoke()
        } else {
          setOverlay("hidden")
          openSelf()
        }
      }
    }
    pill.addView(label)
    pill.addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      leftMargin = dp(10)
    })

    val statusBar = resources.getIdentifier("status_bar_height", "dimen", "android").let {
      if (it > 0) resources.getDimensionPixelSize(it) else dp(24)
    }
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = statusBar + dp(4)
    }
    (getSystemService(WINDOW_SERVICE) as WindowManager).addView(pill, params)
    overlay = pill
    overlayLabel = label
    overlayButton = button
    return pill
  }

  private fun removeOverlay() {
    overlay?.let {
      try {
        (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(it)
      } catch (_: Exception) {
        // Already gone with the service's window token.
      }
    }
    overlay = null
    overlayLabel = null
    overlayButton = null
  }
}

/** Bounds of a node on screen. */
fun boundsOf(node: android.view.accessibility.AccessibilityNodeInfo) = Rect().also { node.getBoundsInScreen(it) }
