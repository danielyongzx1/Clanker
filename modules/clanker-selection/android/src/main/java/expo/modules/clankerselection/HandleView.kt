package expo.modules.clankerselection

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.PopupWindow
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * One of the selection's two drag handles, in a popup window of its own as a text view's are, so
 * it draws over everything and takes its own touches. Uses the theme's handle drawables.
 */
@SuppressLint("ViewConstructor")
internal class HandleView(context: Context, val isStart: Boolean) : View(context) {
  private val drawable: Drawable? = context.obtainStyledAttributes(
    intArrayOf(if (isStart) android.R.attr.textSelectHandleLeft else android.R.attr.textSelectHandleRight)
  ).let {
    val d = it.getDrawable(0)?.mutate()
    it.recycle()
    d
  }
  private val density = resources.displayMetrics.density
  private val drawableWidth = drawable?.intrinsicWidth ?: (22 * density).roundToInt()
  private val drawableHeight = drawable?.intrinsicHeight ?: (22 * density).roundToInt()
  // At least a fingertip wide and tall, the drawable centered across the top.
  private val boxWidth = max(drawableWidth, (44 * density).roundToInt())
  private val boxHeight = max(drawableHeight, (36 * density).roundToInt())
  private val inset = (boxWidth - drawableWidth) / 2
  // The point of the handle, which sits on the selection's edge: the left handle points up and
  // right from its right side, the right one up and left from its left.
  private val hotspotX = inset + if (isStart) drawableWidth * 3 / 4 else drawableWidth / 4

  private val popup = PopupWindow(this, boxWidth, boxHeight).apply {
    isClippingEnabled = false
    isSplitTouchEnabled = true
    windowLayoutType = WindowManager.LayoutParams.TYPE_APPLICATION_SUB_PANEL
  }

  private var caret: Caret? = null
  private var shownX = Int.MIN_VALUE
  private var shownY = Int.MIN_VALUE
  // From the finger to the middle of the line the handle marks, kept through a drag.
  private var offsetX = 0f
  private var offsetY = 0f

  /** Puts the handle under the caret, or hides it while the caret is off screen. */
  fun place(anchor: View, at: Caret?) {
    caret = at
    if (at == null || !at.visible || !anchor.isAttachedToWindow) return hide()
    val x = (at.x - hotspotX).roundToInt()
    val y = at.bottom.roundToInt()
    if (popup.isShowing) {
      if (x != shownX || y != shownY) popup.update(x, y, -1, -1)
    } else {
      popup.showAtLocation(anchor, Gravity.NO_GRAVITY, x, y)
    }
    shownX = x
    shownY = y
  }

  fun hide() {
    if (popup.isShowing) popup.dismiss()
  }

  override fun onDraw(canvas: Canvas) {
    drawable?.setBounds(inset, 0, inset + drawableWidth, drawableHeight)
    drawable?.draw(canvas)
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    val point = Selector.windowPoint(event.rawX, event.rawY) ?: return false
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        val at = caret ?: return false
        offsetX = point.x - at.x
        offsetY = point.y - (at.top + at.bottom) / 2
        Selector.handleDown()
      }
      MotionEvent.ACTION_MOVE -> Selector.handleMove(this, point.x - offsetX, point.y - offsetY)
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> Selector.handleUp()
    }
    return true
  }
}
