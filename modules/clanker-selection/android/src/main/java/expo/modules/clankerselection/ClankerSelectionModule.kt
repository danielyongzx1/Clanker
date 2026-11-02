package expo.modules.clankerselection

import android.content.Context
import android.graphics.Rect
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// Far from the android.R.id values the text toolbar's own items use.
private const val ASK_ID = 0x436c6b
// Right after Copy (5), ahead of Share (7) and Select all (8).
private const val ASK_ORDER = 6

/**
 * Adds "Ask Clanker" to the selection toolbar of selectable text anywhere inside it. A TextView
 * starts that toolbar through its parents, so this takes the request on the way up, wraps the
 * toolbar's callback with the extra item, and hands it on. Picking the item sends the selected
 * text as onAsk and closes the toolbar, which clears the selection.
 */
class AskSelectionView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onAsk by EventDispatcher<Map<String, String>>()

  override fun startActionModeForChild(originalView: View, callback: ActionMode.Callback, type: Int): ActionMode? {
    val wrapped = if (originalView is TextView && originalView.isTextSelectable) AskCallback(callback, originalView) else callback
    return super.startActionModeForChild(originalView, wrapped, type)
  }

  private inner class AskCallback(
    private val inner: ActionMode.Callback,
    private val textView: TextView,
  ) : ActionMode.Callback2() {
    private fun addItem(menu: Menu): Boolean {
      if (menu.findItem(ASK_ID) != null) return false
      // Always shown, as Copy is. Only "if room", it ranks behind the system's own items, and with
      // Select all on the toolbar (anything short of all the text selected) it lands in the overflow.
      menu.add(Menu.NONE, ASK_ID, ASK_ORDER, "Ask Clanker").setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
      return true
    }

    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean =
      inner.onCreateActionMode(mode, menu).also { if (it) addItem(menu) }

    // The toolbar refreshes its items as the selection changes; keep ours among them.
    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
      val changed = inner.onPrepareActionMode(mode, menu)
      return addItem(menu) || changed
    }

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
      if (item.itemId != ASK_ID) return inner.onActionItemClicked(mode, item)
      val start = minOf(textView.selectionStart, textView.selectionEnd)
      val end = maxOf(textView.selectionStart, textView.selectionEnd)
      // Inline views (math, images) sit in the text as object replacement characters.
      val text = if (start in 0 until end) textView.text.subSequence(start, end).toString().replace("￼", "").trim() else ""
      if (text.isNotEmpty()) onAsk(mapOf("text" to text))
      mode.finish()
      return true
    }

    override fun onDestroyActionMode(mode: ActionMode) = inner.onDestroyActionMode(mode)

    // The floating toolbar positions itself over the selection through this.
    override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
      if (inner is ActionMode.Callback2) inner.onGetContentRect(mode, view, outRect)
      else super.onGetContentRect(mode, view, outRect)
    }
  }
}

class ClankerSelectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ClankerSelection")

    View(AskSelectionView::class) {
      Events("onAsk")
    }
  }
}
