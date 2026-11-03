package expo.modules.clankerselection

import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.ActionMode
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.Window
import android.widget.EditText
import android.widget.Magnifier
import android.widget.TextView
import com.facebook.react.R
import java.text.BreakIterator
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Views whose nativeID is this (labels, buttons) are left out of selections, with everything in them. */
private const val SKIP_ID = "clanker-selection-skip"

private const val ID_COPY = 1
private const val ID_ASK = 2
private const val ID_SELECT_ALL = 3

/** A place in the text: before the character at `offset` in `view`. */
internal data class Pos(val view: TextView, val offset: Int)

/** Where a place in the text is drawn, in window coordinates, and whether it's on screen. */
internal class Caret(val x: Float, val top: Float, val bottom: Float, val visible: Boolean)

/**
 * The one selection on screen at a time: which scope it's in, where it starts and ends, and what
 * shows it (highlights, handles, the floating toolbar). Positions are worked out in window
 * coordinates through every view's transform, since the chat is an inverted (flipped) list.
 */
internal object Selector {
  private var scope: SelectionScopeView? = null
  private var start: Pos? = null
  private var end: Pos? = null
  // The word a hold picked, which stays selected while the same hold drags the selection out.
  private var anchor: Pair<Pos, Pos>? = null
  private var dragging = false
  private val highlights = HashMap<TextView, Highlight>()
  private var startHandle: HandleView? = null
  private var endHandle: HandleView? = null
  private var mode: ActionMode? = null
  // Set while this closes the toolbar itself, which shouldn't end the selection.
  private var closingMode = false
  private var lastContentRect: Rect? = null
  private var magnifier: Any? = null
  private var watcher: TapWatcher? = null
  private var observer: ViewTreeObserver? = null
  // Keeps the handles and toolbar on the text as it scrolls, lays out again or streams in.
  private val preDraw = ViewTreeObserver.OnPreDrawListener {
    place()
    true
  }

  // --- Starting and changing the selection ---

  /** Whether a hold at this screen point would land on text in the scope. */
  fun hits(scope: SelectionScopeView, rawX: Float, rawY: Float): Boolean {
    val point = windowPoint(scope, rawX, rawY)
    return textViews(scope).any { contains(it, point) }
  }

  /** Selects the word held at this screen point, replacing any selection. False when there's no text there. */
  fun begin(scope: SelectionScopeView, rawX: Float, rawY: Float): Boolean {
    val point = windowPoint(scope, rawX, rawY)
    val view = textViews(scope).lastOrNull { contains(it, point) } ?: return false
    val local = fromWindow(view, point) ?: return false
    val offset = offsetAt(view, local.x, local.y) ?: return false
    val (from, to) = wordAt(view.text, offset)
    clear()
    this.scope = scope
    start = Pos(view, from)
    end = Pos(view, to)
    anchor = Pos(view, from) to Pos(view, to)
    dragging = true
    watch(scope)
    update()
    return true
  }

  /** Drags the selection out from the held word to the finger, as the hold that made it moves. */
  fun extend(rawX: Float, rawY: Float) {
    val scope = scope ?: return
    val (a, b) = anchor ?: return
    val views = textViews(scope)
    val p = nearest(views, windowPoint(scope, rawX, rawY)) ?: return
    when {
      compare(views, p, a) < 0 -> { start = p; end = b }
      compare(views, p, b) > 0 -> { start = a; end = p }
      else -> { start = a; end = b }
    }
    update()
    magnify(p)
  }

  fun endExtend() {
    anchor = null
    dragging = false
    dismissMagnifier()
    showToolbar()
  }

  fun handleDown() {
    dragging = true
    hideToolbar()
  }

  /** Moves the dragged handle's end of the selection to a window point, keeping at least a character selected. */
  fun handleMove(handle: HandleView, x: Float, y: Float) {
    val scope = scope ?: return
    val s = start ?: return
    val e = end ?: return
    val views = textViews(scope)
    val p = nearest(views, PointF(x, y)) ?: return
    if (handle.isStart) {
      if (compare(views, p, e) < 0) start = p
    } else if (compare(views, p, s) > 0) {
      end = p
    }
    update()
    magnify(p)
  }

  fun handleUp() {
    dragging = false
    dismissMagnifier()
    showToolbar()
  }

  private fun selectAll() {
    val scope = scope ?: return
    val views = textViews(scope)
    if (views.isEmpty()) return
    start = Pos(views.first(), 0)
    end = Pos(views.last(), views.last().text.length)
    update()
  }

  private fun allSelected(): Boolean {
    val scope = scope ?: return false
    val views = textViews(scope)
    return start == Pos(views.firstOrNull() ?: return false, 0) && end == Pos(views.last(), views.last().text.length)
  }

  fun scopeDetached(scope: SelectionScopeView) {
    if (this.scope === scope) clear()
  }

  fun clear() {
    start = null
    end = null
    anchor = null
    dragging = false
    for ((view, highlight) in highlights) view.overlay.remove(highlight)
    highlights.clear()
    startHandle?.hide()
    endHandle?.hide()
    startHandle = null
    endHandle = null
    hideToolbar()
    dismissMagnifier()
    observer?.let { if (it.isAlive) it.removeOnPreDrawListener(preDraw) }
    observer = null
    watcher?.stop()
    watcher = null
    lastContentRect = null
    scope = null
  }

  /** Redraws the highlights for the current selection, then the handles and toolbar. */
  private fun update() {
    val scope = scope ?: return
    val s = start ?: return
    val e = end ?: return
    val views = textViews(scope)
    val first = views.indexOf(s.view)
    val last = views.indexOf(e.view)
    if (first < 0 || last < 0) return clear()
    val selected = HashSet<TextView>()
    for (i in first..last) {
      val view = views[i]
      val highlight = highlights.getOrPut(view) { Highlight(view).also { view.overlay.add(it) } }
      highlight.from = if (i == first) s.offset else 0
      highlight.to = if (i == last) e.offset else Int.MAX_VALUE
      highlight.setBounds(0, 0, view.width, view.height)
      highlight.invalidateSelf()
      selected.add(view)
    }
    val gone = highlights.keys.filter { it !in selected }
    for (view in gone) view.overlay.remove(highlights.remove(view)!!)
    place()
    mode?.invalidate()
  }

  // --- What shows the selection ---

  private fun place() {
    val scope = scope ?: return
    val s = start ?: return
    val e = end ?: return
    for ((view, highlight) in highlights) {
      if (highlight.bounds.width() != view.width || highlight.bounds.height() != view.height) {
        highlight.setBounds(0, 0, view.width, view.height)
      }
    }
    val context = scope.appContext.currentActivity ?: scope.context
    val startCaret = caret(s, false)
    val endCaret = caret(e, true)
    (startHandle ?: HandleView(context, true).also { startHandle = it }).place(scope, startCaret)
    (endHandle ?: HandleView(context, false).also { endHandle = it }).place(scope, endCaret)
    val rect = contentRect(scope, startCaret, endCaret)
    if (rect != lastContentRect) {
      lastContentRect = rect
      mode?.invalidateContentRect()
    }
  }

  private fun showToolbar() {
    val scope = scope ?: return
    if (mode != null || dragging || start == null) return
    mode = scope.startActionMode(toolbar, ActionMode.TYPE_FLOATING)
  }

  private fun hideToolbar() {
    val m = mode ?: return
    mode = null
    closingMode = true
    m.finish()
    closingMode = false
  }

  private val toolbar = object : ActionMode.Callback2() {
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
      menu.add(Menu.NONE, ID_COPY, 0, android.R.string.copy).setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
      menu.add(Menu.NONE, ID_ASK, 1, "Ask Clanker").setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
      if (!allSelected()) addSelectAll(menu)
      return true
    }

    private fun addSelectAll(menu: Menu) {
      menu.add(Menu.NONE, ID_SELECT_ALL, 2, android.R.string.selectAll).setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
      val shown = menu.findItem(ID_SELECT_ALL) != null
      val all = allSelected()
      if (all && shown) menu.removeItem(ID_SELECT_ALL)
      if (!all && !shown) addSelectAll(menu)
      return true
    }

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
      when (item.itemId) {
        ID_COPY -> {
          val scope = scope ?: return true
          scope.context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(null, selectedText()))
          clear()
        }
        ID_ASK -> {
          val text = selectedText()
          if (text.isNotEmpty()) ClankerSelectionModule.ask(text)
          clear()
        }
        ID_SELECT_ALL -> selectAll()
        else -> return false
      }
      return true
    }

    // Closed by the system (another window, the app leaving) rather than by this: the selection goes too.
    override fun onDestroyActionMode(mode: ActionMode) {
      if (!closingMode && Selector.mode === mode) {
        Selector.mode = null
        clear()
      }
    }

    override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
      val rect = lastContentRect
      if (rect != null) outRect.set(rect) else super.onGetContentRect(mode, view, outRect)
    }
  }

  /** The selection's extent in the scope's own coordinates, for the toolbar to sit by. */
  private fun contentRect(scope: View, a: Caret?, b: Caret?): Rect? {
    if (a == null || b == null) return null
    val r = RectF(min(a.x, b.x), min(a.top, b.top), max(a.x, b.x), max(a.bottom, b.bottom))
    // Over more than one line it spans the width.
    if (abs(a.top - b.top) > 1) {
      val bounds = windowBounds(scope)
      r.left = bounds.left
      r.right = bounds.right
    }
    val inverse = Matrix()
    if (!toWindow(scope).invert(inverse)) return null
    inverse.mapRect(r)
    return Rect(r.left.toInt(), r.top.toInt(), ceil(r.right).toInt(), ceil(r.bottom).toInt())
  }

  private fun magnify(p: Pos) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
    val scope = scope ?: return
    val c = caret(p, false) ?: return
    val local = fromWindow(scope, PointF(c.x, (c.top + c.bottom) / 2)) ?: return
    val m = magnifier as? Magnifier ?: Magnifier(scope).also { magnifier = it }
    m.show(local.x, local.y)
  }

  private fun dismissMagnifier() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) (magnifier as? Magnifier)?.dismiss()
    magnifier = null
  }

  private fun watch(scope: View) {
    observer = scope.viewTreeObserver.also { it.addOnPreDrawListener(preDraw) }
    val window = (scope as? SelectionScopeView)?.appContext?.currentActivity?.window ?: return
    watcher = TapWatcher(window, window.callback, ViewConfiguration.get(scope.context).scaledTouchSlop).also { window.callback = it }
  }

  // --- The selected text ---

  /**
   * The text from each selected view in turn: on a new line, or after a space when it sits on the
   * same row as the one before (a list item's bullet, a table's next cell).
   */
  private fun selectedText(): String {
    val scope = scope ?: return ""
    val s = start ?: return ""
    val e = end ?: return ""
    val views = textViews(scope)
    val first = views.indexOf(s.view)
    val last = views.indexOf(e.view)
    if (first < 0 || last < 0) return ""
    val out = StringBuilder()
    var previous: RectF? = null
    for (i in first..last) {
      val view = views[i]
      val text = view.text
      val from = (if (i == first) s.offset else 0).coerceIn(0, text.length)
      val to = (if (i == last) e.offset else text.length).coerceIn(from, text.length)
      // Inline views (math, images) sit in the text as object replacement characters.
      val piece = text.subSequence(from, to).toString().replace("￼", "")
      if (piece.isBlank()) continue
      val bounds = windowBounds(view)
      if (out.isNotEmpty()) {
        val sameRow = previous != null && bounds.top < previous.bottom - 1 && bounds.left >= previous.right - 1
        out.append(if (sameRow) " " else "\n")
      }
      out.append(piece)
      previous = bounds
    }
    return out.toString().trim()
  }

  // --- Text views and positions ---

  /** The text views in the scope in reading order, short of skipped views and inputs. */
  private fun textViews(scope: ViewGroup): List<TextView> {
    val out = ArrayList<TextView>()
    fun walk(view: View) {
      if (view.visibility != View.VISIBLE || view.getTag(R.id.view_tag_native_id) == SKIP_ID || view is EditText) return
      if (view is TextView) {
        if (view.text.isNotEmpty() && view.width > 0 && view.height > 0) out.add(view)
      } else if (view is ViewGroup) {
        for (i in 0 until view.childCount) walk(view.getChildAt(i))
      }
    }
    for (i in 0 until scope.childCount) walk(scope.getChildAt(i))
    return out
  }

  private fun compare(views: List<TextView>, a: Pos, b: Pos): Int {
    val byView = views.indexOf(a.view).compareTo(views.indexOf(b.view))
    return if (byView != 0) byView else a.offset.compareTo(b.offset)
  }

  /** The place in the text nearest a window point: in the view under it, or the one closest above or below. */
  private fun nearest(views: List<TextView>, point: PointF): Pos? {
    var best: TextView? = null
    var bestDy = Float.MAX_VALUE
    var bestDx = Float.MAX_VALUE
    for (view in views) {
      if (!view.isAttachedToWindow) continue
      val r = windowBounds(view)
      val dy = if (point.y < r.top) r.top - point.y else if (point.y > r.bottom) point.y - r.bottom else 0f
      val dx = if (point.x < r.left) r.left - point.x else if (point.x > r.right) point.x - r.right else 0f
      if (dy < bestDy || (dy == bestDy && dx < bestDx)) {
        best = view
        bestDy = dy
        bestDx = dx
      }
    }
    val view = best ?: return null
    val local = fromWindow(view, point) ?: return null
    val offset = offsetAt(view, local.x.coerceIn(0f, view.width.toFloat()), local.y.coerceIn(0f, view.height - 1f)) ?: return null
    return Pos(view, offset)
  }

  private fun offsetAt(view: TextView, x: Float, y: Float): Int? {
    val layout = view.layout ?: return null
    val line = layout.getLineForVertical((y - view.totalPaddingTop + view.scrollY).toInt().coerceAtLeast(0))
    return layout.getOffsetForHorizontal(line, x - view.totalPaddingLeft + view.scrollX).coerceIn(0, view.text.length)
  }

  /** Where a place in the text is drawn. An end at the start of a wrapped line shows at the end of the line before. */
  private fun caret(p: Pos, isEnd: Boolean): Caret? {
    val view = p.view
    val layout = view.layout ?: return null
    val offset = p.offset.coerceIn(0, view.text.length)
    var line = layout.getLineForOffset(offset)
    val x = if (isEnd && line > 0 && offset == layout.getLineStart(line)) {
      line -= 1
      layout.getLineRight(line)
    } else {
      layout.getPrimaryHorizontal(offset)
    }
    val left = (view.totalPaddingLeft - view.scrollX).toFloat()
    val top = (view.totalPaddingTop - view.scrollY).toFloat()
    val pts = floatArrayOf(x + left, layout.getLineTop(line) + top, x + left, layout.getLineBottom(line) + top)
    toWindow(view).mapPoints(pts)
    val lineTop = min(pts[1], pts[3])
    val lineBottom = max(pts[1], pts[3])
    val visibleRect = Rect()
    val middle = (lineTop + lineBottom) / 2
    val visible = view.isAttachedToWindow &&
      view.getGlobalVisibleRect(visibleRect) &&
      pts[0] >= visibleRect.left - 2 && pts[0] <= visibleRect.right + 2 &&
      middle >= visibleRect.top && middle <= visibleRect.bottom
    return Caret(pts[0], lineTop, lineBottom, visible)
  }

  private fun wordAt(text: CharSequence, offset: Int): Pair<Int, Int> {
    if (text.isEmpty()) return 0 to 0
    val string = text.toString()
    val o = offset.coerceIn(0, string.length - 1)
    val words = BreakIterator.getWordInstance()
    words.setText(string)
    var to = words.following(o)
    if (to == BreakIterator.DONE) to = string.length
    var from = words.previous()
    if (from == BreakIterator.DONE || from > o) from = o
    // Whitespace or a mark between words: just that character.
    if (to <= from || string.substring(from, to).isBlank()) return o to o + 1
    return from to to
  }

  // --- Coordinates ---

  /** From a view's own coordinates to its window's, through every transform and scroll above it. */
  private fun toWindow(view: View): Matrix {
    val m = Matrix()
    var v = view
    while (true) {
      if (!v.matrix.isIdentity) m.postConcat(v.matrix)
      m.postTranslate(v.left.toFloat(), v.top.toFloat())
      val parent = v.parent as? View ?: break
      m.postTranslate(-parent.scrollX.toFloat(), -parent.scrollY.toFloat())
      v = parent
    }
    return m
  }

  private fun fromWindow(view: View, point: PointF): PointF? {
    val inverse = Matrix()
    if (!toWindow(view).invert(inverse)) return null
    val pts = floatArrayOf(point.x, point.y)
    inverse.mapPoints(pts)
    return PointF(pts[0], pts[1])
  }

  private fun windowBounds(view: View): RectF {
    val r = RectF(0f, 0f, view.width.toFloat(), view.height.toFloat())
    toWindow(view).mapRect(r)
    return r
  }

  private fun contains(view: TextView, point: PointF): Boolean {
    if (!view.isAttachedToWindow) return false
    val local = fromWindow(view, point) ?: return false
    return local.x >= 0 && local.y >= 0 && local.x < view.width && local.y < view.height
  }

  /** A screen point in the coordinates of the window the scope is in. */
  private fun windowPoint(scope: View, rawX: Float, rawY: Float): PointF {
    val location = IntArray(2)
    scope.rootView.getLocationOnScreen(location)
    return PointF(rawX - location[0], rawY - location[1])
  }

  fun windowPoint(rawX: Float, rawY: Float): PointF? = scope?.let { windowPoint(it, rawX, rawY) }

  /** The selected stretch of one text view, drawn over it. */
  private class Highlight(private val view: TextView) : Drawable() {
    var from = 0
    var to = 0
    private val path = Path()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = view.highlightColor.takeIf { Color.alpha(it) != 0 } ?: 0x6633B5E5
    }

    override fun draw(canvas: Canvas) {
      val layout = view.layout ?: return
      val length = view.text.length
      val s = from.coerceIn(0, length)
      val e = to.coerceIn(0, length)
      if (s >= e) return
      path.reset()
      layout.getSelectionPath(s, e, path)
      canvas.save()
      canvas.translate(view.totalPaddingLeft.toFloat(), view.totalPaddingTop.toFloat())
      canvas.drawPath(path, paint)
      canvas.restore()
    }

    override fun setAlpha(alpha: Int) {}

    override fun setColorFilter(colorFilter: ColorFilter?) {}

    @Deprecated("Deprecated in Java")
    override fun getOpacity() = PixelFormat.TRANSLUCENT
  }

  /**
   * Sees every touch in the window while a selection is up, so a tap anywhere (or Back) clears it
   * as it would clear a text view's own selection. The touches still go where they were going.
   */
  private class TapWatcher(
    private val window: Window,
    private val inner: Window.Callback,
    private val slop: Int,
  ) : Window.Callback by inner {
    private var on = true
    private var downX = 0f
    private var downY = 0f
    private var downAt = 0L
    private var moved = false

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
      if (on) {
        when (event.actionMasked) {
          MotionEvent.ACTION_DOWN -> {
            downX = event.rawX
            downY = event.rawY
            downAt = event.eventTime
            moved = false
          }
          MotionEvent.ACTION_MOVE -> if (hypot(event.rawX - downX, event.rawY - downY) > slop) moved = true
          // A hold isn't a tap: it may be the one that made the selection.
          MotionEvent.ACTION_UP -> if (!moved && event.eventTime - downAt < ViewConfiguration.getLongPressTimeout()) {
            window.decorView.post { if (on) clear() }
          }
        }
      }
      return inner.dispatchTouchEvent(event)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
      if (on && event.keyCode == KeyEvent.KEYCODE_BACK) {
        if (event.action == KeyEvent.ACTION_UP) clear()
        return true
      }
      return inner.dispatchKeyEvent(event)
    }

    fun stop() {
      on = false
      if (window.callback === this) window.callback = inner
    }
  }
}
