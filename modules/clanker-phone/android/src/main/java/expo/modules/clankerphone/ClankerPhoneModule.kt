package expo.modules.clankerphone

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

// More elements than this make the listing too long to be useful; the rest are dropped.
private const val MAX_ELEMENTS = 300
private const val MAX_TEXT = 200
// Registered in JS (src/lib/tools/phone.ts); runs for as long as the agent is using the phone.
private const val KEEP_ALIVE_TASK = "ClankerPhoneKeepAlive"

class PhoneException(message: String) : CodedException(message)

class ScreenshotFailure(val errorCode: Int) : CodedException(
  when (errorCode) {
    AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> "Screenshots were taken too quickly; wait a moment and try again."
    AccessibilityService.ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS -> "The accessibility service is not allowed to take screenshots."
    6 -> "The app on screen blocks screenshots (a secure window, as banking and password apps use)."
    else -> "The screenshot failed (error $errorCode)."
  }
)

class ClankerPhoneModule : Module() {
  // The nodes of the last `screen` listing, by index, for the actions to refer to.
  @Volatile private var nodes: List<AccessibilityNodeInfo> = emptyList()
  private var keepAliveTask = -1

  private val context: Context
    get() = appContext.reactContext ?: throw PhoneException("The app context is gone.")

  override fun definition() = ModuleDefinition {
    Name("ClankerPhone")

    Events("onStop")

    OnCreate {
      PhoneService.onStop = { sendEvent("onStop", mapOf<String, Any?>()) }
    }

    OnDestroy {
      PhoneService.onStop = null
    }

    /** Whether the user has the accessibility service turned on. */
    Function("isEnabled") {
      PhoneService.instance != null
    }

    /** The app in front and its visible elements, numbered for the actions below. */
    AsyncFunction("screen") Coroutine { ->
      val service = service()
      withContext(Dispatchers.IO) { snapshot(service) }
    }

    /**
     * A JPEG of the whole screen in the cache folder, without the overlay, scaled down to `maxEdge`.
     * Done here rather than in JS because the image manipulator's loader stalls while Clanker is in
     * the background.
     */
    AsyncFunction("screenshot") Coroutine { maxEdge: Int ->
      val service = service()
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) throw PhoneException("Screenshots need Android 11 or later.")
      service.onMain { service.setOverlayVisible(false) }
      val bitmap = try {
        // A frame for the overlay to leave the screen.
        delay(80)
        try {
          service.capture()
        } catch (e: ScreenshotFailure) {
          // At most about one screenshot a second is allowed; one retry covers a quick follow-up.
          if (e.errorCode != AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT) throw e
          delay(1000)
          service.capture()
        }
      } finally {
        service.onMain { service.setOverlayVisible(true) }
      }
      withContext(Dispatchers.IO) {
        val scale = minOf(1f, maxEdge.toFloat() / maxOf(bitmap.width, bitmap.height))
        val scaled = if (scale < 1f) {
          Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
        } else bitmap
        val dir = File(context.cacheDir, "phone-shots").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "${System.currentTimeMillis()}.jpg")
        FileOutputStream(file).use { scaled.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        val result = mapOf("uri" to "file://${file.absolutePath}", "width" to scaled.width, "height" to scaled.height)
        if (scaled !== bitmap) scaled.recycle()
        bitmap.recycle()
        result
      }
    }

    /** Taps (or long-presses) an element from the last listing. */
    AsyncFunction("tap") Coroutine { index: Int, long: Boolean ->
      val service = service()
      val node = nodeAt(index)
      val action = if (long) AccessibilityNodeInfo.ACTION_LONG_CLICK else AccessibilityNodeInfo.ACTION_CLICK
      var target: AccessibilityNodeInfo? = node
      while (target != null && !(if (long) target.isLongClickable else target.isClickable)) target = target.parent
      val done = target?.performAction(action) == true
      if (!done) {
        val b = boundsOf(node)
        if (!service.gesture(pointPath(b.exactCenterX(), b.exactCenterY()), if (long) 700 else 60)) {
          throw PhoneException("The tap on element $index was cancelled.")
        }
      }
      service.awaitIdle()
      "${if (long) "Long-pressed" else "Tapped"} element $index${if (done) "" else " (by touching its centre)"}."
    }

    AsyncFunction("tapAt") Coroutine { x: Double, y: Double, durationMs: Long ->
      val service = service()
      if (!service.gesture(pointPath(x.toFloat(), y.toFloat()), durationMs)) throw PhoneException("The tap was cancelled.")
      service.awaitIdle()
      "${if (durationMs >= 500) "Long-pressed" else "Tapped"} (${x.toInt()}, ${y.toInt()})."
    }

    AsyncFunction("swipe") Coroutine { x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Long ->
      val service = service()
      val path = Path().apply {
        moveTo(x1.toFloat(), y1.toFloat())
        lineTo(x2.toFloat(), y2.toFloat())
      }
      if (!service.gesture(path, durationMs)) throw PhoneException("The swipe was cancelled.")
      service.awaitIdle()
      "Swiped from (${x1.toInt()}, ${y1.toInt()}) to (${x2.toInt()}, ${y2.toInt()})."
    }

    /**
     * Replaces the text of an element (index -1: the focused field) and optionally presses the
     * keyboard's enter/search/send key.
     */
    AsyncFunction("type") Coroutine { index: Int, text: String, submit: Boolean ->
      val service = service()
      var field = if (index >= 0) nodeAt(index) else focusedInput(service)
      if (field == null || !field.isEditable) {
        // Tapping a search icon or a field's container usually focuses the real input.
        field?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        service.awaitIdle()
        field = focusedInput(service)?.takeIf { it.isEditable }
          ?: throw PhoneException(
            if (index >= 0) "Element $index is not a text field, and tapping it focused none. Tap the field first."
            else "No text field has focus. Tap one first, or pass its element number."
          )
      }
      field.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
      val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
      var how = ""
      if (!field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
        service.onMain {
          val clipboard = service.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
          clipboard.setPrimaryClip(ClipData.newPlainText("text", text))
        }
        if (!field.performAction(AccessibilityNodeInfo.ACTION_PASTE)) throw PhoneException("The field would not take the text.")
        how = " (pasted)"
      }
      var note = ""
      if (submit) {
        service.awaitIdle(200, 1000)
        note = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
          field.performAction(AccessibilityAction.ACTION_IME_ENTER.id)
        ) " and pressed enter" else ". Pressing enter isn't supported here; tap the send or search button instead"
      }
      service.awaitIdle()
      "Typed ${text.length} characters$how$note."
    }

    /** Scrolls an element (index -1: the largest scrollable one), falling back to a swipe. */
    AsyncFunction("scroll") Coroutine { index: Int, direction: String ->
      val service = service()
      val node = if (index >= 0) nodeAt(index) else largestScrollable(service)
      var target: AccessibilityNodeInfo? = node
      while (target != null && !target.isScrollable) target = target.parent
      if (target != null && scrollNode(target, direction)) {
        service.awaitIdle()
        return@Coroutine "Scrolled $direction${if (index >= 0) " in element $index" else ""}."
      }
      // Content moves the opposite way to the finger.
      val (w, h) = service.screenSize()
      val b = node?.let { boundsOf(it) }
      val cx = (b?.exactCenterX() ?: (w / 2f)).toDouble()
      val cy = (b?.exactCenterY() ?: (h / 2f)).toDouble()
      val dx = (b?.width() ?: w) * 0.3
      val dy = (b?.height() ?: h) * 0.3
      val path = Path()
      when (direction) {
        "down" -> { path.moveTo(cx.toFloat(), (cy + dy).toFloat()); path.lineTo(cx.toFloat(), (cy - dy).toFloat()) }
        "up" -> { path.moveTo(cx.toFloat(), (cy - dy).toFloat()); path.lineTo(cx.toFloat(), (cy + dy).toFloat()) }
        "right" -> { path.moveTo((cx + dx).toFloat(), cy.toFloat()); path.lineTo((cx - dx).toFloat(), cy.toFloat()) }
        "left" -> { path.moveTo((cx - dx).toFloat(), cy.toFloat()); path.lineTo((cx + dx).toFloat(), cy.toFloat()) }
        else -> throw PhoneException("Unknown direction \"$direction\".")
      }
      if (!service.gesture(path, 350)) throw PhoneException("The scroll gesture was cancelled.")
      service.awaitIdle()
      "Swiped to scroll $direction."
    }

    AsyncFunction("globalAction") Coroutine { name: String ->
      val service = service()
      val action = when (name) {
        "back" -> AccessibilityService.GLOBAL_ACTION_BACK
        "home" -> AccessibilityService.GLOBAL_ACTION_HOME
        "recents" -> AccessibilityService.GLOBAL_ACTION_RECENTS
        "notifications" -> AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
        "quick_settings" -> AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
        else -> throw PhoneException("Unknown key \"$name\".")
      }
      if (!service.performGlobalAction(action)) throw PhoneException("The system refused to press $name.")
      service.awaitIdle()
      "Pressed $name."
    }

    /** Apps with a launcher icon, as { label, package }, sorted by label. */
    AsyncFunction("listApps") Coroutine { ->
      withContext(Dispatchers.IO) {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        pm.queryIntentActivities(intent, 0)
          .map { mapOf("label" to it.loadLabel(pm).toString(), "package" to it.activityInfo.packageName) }
          .distinctBy { it["package"] }
          .sortedBy { it["label"]!!.lowercase() }
      }
    }

    AsyncFunction("launchApp") Coroutine { pkg: String ->
      val service = service()
      val intent = service.packageManager.getLaunchIntentForPackage(pkg) ?: throw PhoneException("No launchable app \"$pkg\".")
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      // Started from the service, which may open activities while Clanker is in the background.
      service.startActivity(intent)
      service.awaitIdle(500, 4000)
      "Opened $pkg."
    }

    /**
     * Keeps JS timers running while Clanker is in the background. React Native pauses them with
     * its activity unless a headless JS task is active, so while the agent works in other apps a
     * long-lived task holds them on; `false` finishes it.
     */
    AsyncFunction("keepAwake") { on: Boolean ->
      val react = appContext.reactContext as? ReactContext ?: return@AsyncFunction
      val tasks = HeadlessJsTaskContext.getInstance(react)
      if (on) {
        if (!tasks.isTaskRunning(keepAliveTask)) {
          keepAliveTask = tasks.startTask(HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), 0, true))
        }
      } else if (keepAliveTask >= 0) {
        tasks.finishTask(keepAliveTask)
        keepAliveTask = -1
      }
    }.runOnQueue(Queues.MAIN)

    /** "working", "done" or "hidden"; a no-op while the service is off. */
    AsyncFunction("setOverlay") Coroutine { state: String ->
      PhoneService.instance?.let { it.onMain { it.setOverlay(state) } }
      Unit
    }
  }

  private fun service() =
    PhoneService.instance ?: throw PhoneException("Phone control is off. Turn on Clanker phone control in Android's accessibility settings.")

  private fun nodeAt(index: Int): AccessibilityNodeInfo {
    val node = nodes.getOrNull(index) ?: throw PhoneException("There is no element $index. Read the screen again for current numbers.")
    if (!node.refresh() || !node.isVisibleToUser) {
      throw PhoneException("Element $index is no longer on screen. Read the screen again for current numbers.")
    }
    return node
  }

  private fun focusedInput(service: PhoneService) =
    service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: service.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)

  private suspend fun root(service: PhoneService): AccessibilityNodeInfo {
    // Between screens there may briefly be no active window.
    repeat(10) {
      service.rootInActiveWindow?.let { return it }
      delay(100)
    }
    throw PhoneException("Could not read the screen (no active window). Try again in a moment.")
  }

  private suspend fun snapshot(service: PhoneService): Map<String, Any?> {
    val root = root(service)
    val found = mutableListOf<AccessibilityNodeInfo>()
    val elements = mutableListOf<Map<String, Any?>>()
    val (w, h) = service.screenSize()

    fun add(node: AccessibilityNodeInfo, text: String) {
      if (found.size >= MAX_ELEMENTS) return
      val b = boundsOf(node)
      if (b.width() <= 0 || b.height() <= 0 || b.right <= 0 || b.bottom <= 0 || b.left >= w || b.top >= h) return
      val flags = mutableListOf<String>()
      if (node.isClickable) flags.add("click")
      if (node.isLongClickable) flags.add("longclick")
      if (node.isEditable) flags.add("edit")
      if (node.isScrollable) flags.add("scroll")
      if (node.isCheckable) flags.add(if (node.isChecked) "checked" else "unchecked")
      if (node.isSelected) flags.add("selected")
      if (node.isFocused) flags.add("focused")
      if (!node.isEnabled) flags.add("disabled")
      if (node.isPassword) flags.add("password")
      val desc = node.contentDescription?.toString().orEmpty()
      val hint = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) node.hintText?.toString().orEmpty() else ""
      elements.add(
        mapOf(
          "index" to found.size,
          "cls" to (node.className?.toString()?.substringAfterLast('.') ?: "View"),
          "text" to text.take(MAX_TEXT),
          "desc" to (if (desc == text) "" else desc.take(MAX_TEXT)),
          "hint" to (if (hint == text) "" else hint.take(MAX_TEXT)),
          "id" to (node.viewIdResourceName?.substringAfter(":id/") ?: ""),
          "x" to b.centerX(),
          "y" to b.centerY(),
          "flags" to flags,
        )
      )
      found.add(node)
    }

    // A tappable node without a label of its own is named by the text inside it, which is then
    // not listed again.
    fun walk(node: AccessibilityNodeInfo, absorbed: Boolean, depth: Int) {
      if (depth > 60 || !node.isVisibleToUser) return
      val own = labelOf(node)
      val tappable = node.isClickable || node.isLongClickable
      val actionable = tappable || node.isEditable || node.isScrollable || node.isCheckable
      var absorb = absorbed
      if (actionable) {
        val named = own.isEmpty() && tappable && !node.isScrollable
        add(node, if (named) innerText(node) else own)
        if (named) absorb = true
      } else if (own.isNotEmpty() && !absorbed) {
        add(node, own)
      }
      for (i in 0 until node.childCount) node.getChild(i)?.let { walk(it, absorb, depth + 1) }
    }
    walk(root, false, 0)
    nodes = found

    val pkg = root.packageName?.toString().orEmpty()
    val label = try {
      service.packageManager.getApplicationLabel(service.packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      pkg
    }
    return mapOf(
      "package" to pkg,
      "appLabel" to label,
      "width" to w,
      "height" to h,
      "truncated" to (found.size >= MAX_ELEMENTS),
      "elements" to elements,
    )
  }

  private fun labelOf(node: AccessibilityNodeInfo): String {
    val text = node.text?.toString()?.trim().orEmpty()
    return text.ifEmpty { node.contentDescription?.toString()?.trim().orEmpty() }
  }

  private fun innerText(node: AccessibilityNodeInfo): String {
    val parts = mutableListOf<String>()
    fun visit(n: AccessibilityNodeInfo, depth: Int) {
      if (depth > 8 || parts.size >= 6) return
      for (i in 0 until n.childCount) {
        val child = n.getChild(i) ?: continue
        if (!child.isVisibleToUser) continue
        labelOf(child).takeIf { it.isNotEmpty() }?.let { parts.add(it) }
        visit(child, depth + 1)
      }
    }
    visit(node, 0)
    return parts.joinToString(" · ")
  }

  private fun largestScrollable(service: PhoneService): AccessibilityNodeInfo? {
    var best: AccessibilityNodeInfo? = null
    var bestArea = 0
    fun visit(n: AccessibilityNodeInfo, depth: Int) {
      if (depth > 60 || !n.isVisibleToUser) return
      if (n.isScrollable) {
        val b = boundsOf(n)
        val area = b.width() * b.height()
        if (area > bestArea) {
          best = n
          bestArea = area
        }
      }
      for (i in 0 until n.childCount) n.getChild(i)?.let { visit(it, depth + 1) }
    }
    service.rootInActiveWindow?.let { visit(it, 0) }
    return best
  }

  private fun scrollNode(node: AccessibilityNodeInfo, direction: String): Boolean {
    val specific = when (direction) {
      "down" -> AccessibilityAction.ACTION_SCROLL_DOWN
      "up" -> AccessibilityAction.ACTION_SCROLL_UP
      "left" -> AccessibilityAction.ACTION_SCROLL_LEFT
      "right" -> AccessibilityAction.ACTION_SCROLL_RIGHT
      else -> return false
    }
    if (node.actionList.any { it.id == specific.id } && node.performAction(specific.id)) return true
    val generic = if (direction == "down" || direction == "right") AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
    else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
    return node.performAction(generic)
  }

  private fun pointPath(x: Float, y: Float) = Path().apply { moveTo(x, y) }
}
