package expo.modules.clankerscroll

import android.content.Context
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView

/**
 * Sits between a scroll view and an inverted list it's nested in. Android hands the scroll a nested
 * view can't use on to the scroll view around it as a raw distance, which an inverted list (drawn
 * upside down) applies backwards. This takes the hand-off in place of the list and passes it on
 * with the vertical direction turned around; flings too.
 *
 * Flipping the nested view to match the list instead gets the direction right, but the nested view
 * then corrects the finger's position by how far the list moved it on screen, which is in screen
 * terms and so backwards in the flipped view's own, and the scroll stutters at its ends.
 */
class InvertedScrollRelayView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val consumed = IntArray(2)

  init {
    isNestedScrollingEnabled = true
  }

  override fun onStartNestedScroll(child: View, target: View, axes: Int): Boolean =
    axes and View.SCROLL_AXIS_VERTICAL != 0

  override fun onNestedScrollAccepted(child: View, target: View, axes: Int) {
    super.onNestedScrollAccepted(child, target, axes)
    startNestedScroll(View.SCROLL_AXIS_VERTICAL)
  }

  override fun onStopNestedScroll(target: View) {
    super.onStopNestedScroll(target)
    stopNestedScroll()
  }

  override fun onNestedPreScroll(target: View, dx: Int, dy: Int, out: IntArray) {
    consumed[0] = 0
    consumed[1] = 0
    if (dispatchNestedPreScroll(dx, -dy, consumed, null)) {
      out[0] = consumed[0]
      out[1] = -consumed[1]
    }
  }

  override fun onNestedScroll(target: View, dxConsumed: Int, dyConsumed: Int, dxUnconsumed: Int, dyUnconsumed: Int) {
    dispatchNestedScroll(dxConsumed, -dyConsumed, dxUnconsumed, -dyUnconsumed, null)
  }

  override fun onNestedPreFling(target: View, velocityX: Float, velocityY: Float): Boolean =
    dispatchNestedPreFling(velocityX, -velocityY)

  override fun onNestedFling(target: View, velocityX: Float, velocityY: Float, consumed: Boolean): Boolean =
    dispatchNestedFling(velocityX, -velocityY, consumed)
}

class ClankerScrollModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ClankerScroll")

    View(InvertedScrollRelayView::class) {}
  }
}
