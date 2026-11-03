package expo.modules.clankerselection

import android.content.Context
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.ViewConfiguration
import com.facebook.react.uimanager.events.NativeGestureUtil
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import kotlin.math.hypot

/**
 * A stretch of text (a reply, a message) selected as one: holding on any text in it selects a word
 * there, and the handles then carry the selection across every text view inside, which Android's
 * own selection can't do, as it stays within one view. The text inside isn't natively selectable;
 * views tagged with the skip nativeID (labels, buttons) are left out.
 *
 * The touches go on to the content as usual; only once a hold turns into a selection does this take
 * the rest of the gesture, which then drags out the selection.
 */
class SelectionScopeView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val slop = ViewConfiguration.get(context).scaledTouchSlop
  private var downX = 0f
  private var downY = 0f
  private var down: MotionEvent? = null
  // Whether this gesture became a selection, so the rest of it drags the selection out.
  private var selecting = false

  private val longPress = Runnable {
    val event = down ?: return@Runnable
    if (!Selector.begin(this, event.rawX, event.rawY)) return@Runnable
    selecting = true
    performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    // The content (links, buttons) and the list around stop following the finger.
    val cancel = MotionEvent.obtain(event.downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_CANCEL, event.x, event.y, 0)
    super.dispatchTouchEvent(cancel)
    cancel.recycle()
    parent?.requestDisallowInterceptTouchEvent(true)
    NativeGestureUtil.notifyNativeGestureStarted(this, event)
  }

  /** Inside another scope, which selects for it. */
  private val nested: Boolean
    get() {
      var p = parent
      while (p != null) {
        if (p is SelectionScopeView) return true
        p = p.parent
      }
      return false
    }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (selecting) {
      when (ev.actionMasked) {
        MotionEvent.ACTION_MOVE -> Selector.extend(ev.rawX, ev.rawY)
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          selecting = false
          NativeGestureUtil.notifyNativeGestureEnded(this, ev)
          Selector.endExtend()
        }
      }
      return true
    }
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        down?.recycle()
        down = MotionEvent.obtain(ev)
        downX = ev.rawX
        downY = ev.rawY
        if (!nested && Selector.hits(this, ev.rawX, ev.rawY)) {
          postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
        }
      }
      MotionEvent.ACTION_MOVE -> if (hypot(ev.rawX - downX, ev.rawY - downY) > slop) removeCallbacks(longPress)
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN -> removeCallbacks(longPress)
    }
    return super.dispatchTouchEvent(ev)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    removeCallbacks(longPress)
    selecting = false
    Selector.scopeDetached(this)
  }
}

class ClankerSelectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ClankerSelection")

    Events("onAsk")

    OnCreate {
      current = this@ClankerSelectionModule
    }

    OnDestroy {
      if (current === this@ClankerSelectionModule) current = null
      Selector.clear()
    }

    View(SelectionScopeView::class) {}
  }

  companion object {
    /** Where "Ask Clanker" sends the selected text. */
    internal var current: ClankerSelectionModule? = null

    internal fun ask(text: String) {
      current?.sendEvent("onAsk", mapOf("text" to text))
    }
  }
}
