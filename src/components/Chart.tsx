import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

/** What a ```chart block holds, normalized from the shapes the model may write. */
export type ChartSpec = {
  type: 'bar' | 'hbar' | 'line';
  title?: string;
  caption?: string;
  unit?: string;
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
};

// Categorical slots in fixed order (validated for CVD separation on both surfaces; see the dataviz reference palette).
const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
const CHROME = {
  light: { grid: '#e1e0d9', axis: '#c3c2b7', muted: '#898781' },
  dark: { grid: '#2c2c2a', axis: '#383835', muted: '#898781' },
};

const PLOT_HEIGHT = 200;
// The assistant row's side padding.
export const REPLY_GUTTER = 32;
// Room above the tallest column for its value.
const CAP_ROOM = 20;
const MAX_BAR = 24;
const BAR_GAP = 2;
const RADIUS = 4;
// Rough width of one character of the 11-12px chart labels, for fitting labels without measuring.
const CHAR_W = 6.6;

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/[, ]/g, '')) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Reads a chart block's JSON; null when it isn't a chart this can draw. */
export function parseChart(json: string): ChartSpec | null {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  let labels: string[];
  let series: ChartSpec['series'];
  if (Array.isArray(raw.data)) {
    labels = raw.data.map((d: any) => String(d?.label ?? d?.name ?? ''));
    series = [{ name: String(raw.name ?? raw.title ?? ''), values: raw.data.map((d: any) => num(d?.value)) }];
  } else if (Array.isArray(raw.labels)) {
    labels = raw.labels.map(String);
    const list = Array.isArray(raw.series) ? raw.series : Array.isArray(raw.values) ? [{ name: raw.title, values: raw.values }] : [];
    series = list
      .filter((s: any) => Array.isArray(s?.values ?? s?.data))
      .map((s: any) => ({ name: String(s.name ?? ''), values: labels.map((_, i) => num((s.values ?? s.data)[i])) }));
  } else return null;
  // Past eight, series would need generated colors; they are dropped instead.
  series = series.slice(0, 8);
  if (!labels.length || !series.some((s) => s.values.some((v) => v != null))) return null;
  const type = String(raw.type ?? 'bar').toLowerCase();
  return {
    type: type === 'line' || type === 'area' ? 'line' : /^h|horizontal/.test(type) ? 'hbar' : 'bar',
    title: raw.title ? String(raw.title) : undefined,
    caption: raw.caption ? String(raw.caption) : undefined,
    unit: raw.unit ? String(raw.unit) : undefined,
    labels,
    series,
  };
}

/** Short form of `n`: 4.6K, 1.2M. Axis ticks shorten from 1,000; values keep four digits whole. */
function compact(n: number, axis = false) {
  const a = Math.abs(n);
  const short = (x: number) => String(Number(x.toFixed(Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2)));
  if (a >= 1e9) return `${short(n / 1e9)}B`;
  if (a >= 1e6) return `${short(n / 1e6)}M`;
  if (a >= (axis ? 1e3 : 1e4)) return `${short(n / 1e3)}K`;
  return a >= 1000 ? Math.round(n).toLocaleString('en-US') : short(n);
}

function formatValue(n: number, unit?: string, axis = false) {
  const v = compact(n, axis);
  if (!unit) return v;
  if (/^[$€£¥₹]$/.test(unit)) return n < 0 ? `-${unit}${v.slice(1)}` : `${unit}${v}`;
  return unit === '%' ? `${v}%` : `${v} ${unit}`;
}

/** Round tick values spanning [min, max], about `count` steps. */
function niceTicks(min: number, max: number, count = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= Math.ceil(max / step) * step + step / 2; t += step) {
    ticks.push(Number(t.toPrecision(12)));
  }
  return ticks;
}

/** A column from the baseline `y0` to the value `y1`, rounded only at its data end. */
function columnPath(x: number, w: number, y0: number, y1: number) {
  const r = Math.min(RADIUS, w / 2, Math.abs(y1 - y0));
  if (y1 <= y0) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function Legend({ series, colors }: { series: ChartSpec['series']; colors: string[] }) {
  const { colors: theme } = useTheme();
  if (series.length < 2) return null;
  return (
    <View style={styles.legend}>
      {series.map((s, i) => (
        <View key={i} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors[i] }]} />
          <Text style={[styles.legendText, { color: theme.textSecondary }]}>{s.name}</Text>
        </View>
      ))}
    </View>
  );
}

/** Horizontal bars, each value at its tip: for long category names or many categories. */
function Bars({ spec, width, colors }: { spec: ChartSpec; width: number; colors: string[] }) {
  const { colors: theme } = useTheme();
  const values = spec.series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const max = Math.max(...values, 0) || 1;
  const labelRoom = Math.max(...values.map((v) => formatValue(v, spec.unit).length)) * CHAR_W + 10;
  const track = Math.max(40, width - labelRoom);
  return (
    <View style={styles.bars}>
      {spec.labels.map((label, i) => (
        <View key={i} style={styles.barGroup}>
          <Text numberOfLines={2} style={[styles.barLabel, { color: theme.text }]}>
            {label}
          </Text>
          {spec.series.map((s, j) => {
            const v = s.values[i];
            return (
              <View key={j} style={styles.barRow}>
                {v != null && (
                  <View
                    style={[styles.bar, { width: Math.max(2, (Math.max(0, v) / max) * track), backgroundColor: colors[j] }]}
                  />
                )}
                <Text style={[styles.value, { color: theme.textSecondary }]}>
                  {v == null ? '–' : formatValue(v, spec.unit)}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** Columns or lines over a shared category axis, with a tap-to-read layer. */
function Plot({ spec, width, colors }: { spec: ChartSpec; width: number; colors: string[] }) {
  const { colors: theme, scheme } = useTheme();
  const chrome = CHROME[scheme];
  const [selected, setSelected] = useState<number | null>(null);
  const isLine = spec.type === 'line';
  const n = spec.series.length;
  const values = spec.series.flatMap((s) => s.values).filter((v): v is number => v != null);
  let lo = Math.min(...values);
  const hi = Math.max(...values);
  // Columns grow from zero; lines may zoom in on a range far from it.
  lo = !isLine || lo <= 0 || lo < hi * 0.5 ? Math.min(0, lo) : lo;
  const ticks = niceTicks(lo, isLine ? hi : Math.max(0, hi));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tickLabels = ticks.map((t) => formatValue(t, spec.unit, true));
  const left = Math.max(...tickLabels.map((t) => t.length)) * CHAR_W + 8;
  const plotW = Math.max(40, width - left);
  const band = plotW / spec.labels.length;
  const top = CAP_ROOM;
  const bottom = PLOT_HEIGHT - 4;
  const y = (v: number) => bottom - ((v - yMin) / (yMax - yMin || 1)) * (bottom - top);
  const cx = (i: number) => left + band * (i + 0.5);

  const thickness = Math.max(3, Math.min(MAX_BAR, (band * 0.75 - (n - 1) * BAR_GAP) / n));
  const groupW = n * thickness + (n - 1) * BAR_GAP;
  const capLabels = values.map((v) => formatValue(v, spec.unit));
  // Values ride the column caps only while every one fits over its column.
  const showCaps =
    !isLine && values.length <= 12 && Math.max(...capLabels.map((l) => l.length)) * CHAR_W <= (n === 1 ? band - 4 : thickness + BAR_GAP);
  const zero = y(Math.max(yMin, Math.min(0, yMax)));

  // Lines end in a dot labeled with the last value, while the labels stay clear of each other.
  const ends = isLine
    ? spec.series
        .map((s, j) => {
          const i = s.values.findLastIndex((v) => v != null);
          return i < 0 ? null : { j, i, v: s.values[i]!, y: y(s.values[i]!) };
        })
        .filter((e) => e != null)
    : [];
  const endLabels = ends.length <= 3 && ends.every((a, k) => ends.every((b, m) => m === k || Math.abs(a.y - b.y) > 14));

  return (
    <View>
      <Svg width={width} height={PLOT_HEIGHT}>
        {ticks.map((t, k) => (
          <Line
            key={`g${k}`}
            x1={left}
            x2={width}
            y1={y(t)}
            y2={y(t)}
            stroke={t === 0 && !isLine ? chrome.axis : chrome.grid}
            strokeWidth={1}
          />
        ))}
        {ticks.map((t, k) => (
          <SvgText key={`t${k}`} x={left - 8} y={y(t) + 4} fontSize={11} fill={chrome.muted} textAnchor="end">
            {tickLabels[k]}
          </SvgText>
        ))}
        {!isLine &&
          spec.labels.map((_, i) =>
            spec.series.map((s, j) => {
              const v = s.values[i];
              if (v == null) return null;
              const x = cx(i) - groupW / 2 + j * (thickness + BAR_GAP);
              const dim = selected != null && selected !== i;
              return (
                <Path key={`b${i}-${j}`} d={columnPath(x, thickness, zero, y(v))} fill={colors[j]} opacity={dim ? 0.35 : 1} />
              );
            })
          )}
        {showCaps &&
          spec.labels.map((_, i) =>
            spec.series.map((s, j) => {
              const v = s.values[i];
              if (v == null) return null;
              const x = cx(i) - groupW / 2 + j * (thickness + BAR_GAP) + thickness / 2;
              return (
                <SvgText
                  key={`c${i}-${j}`}
                  x={x}
                  y={v >= 0 ? y(v) - 6 : y(v) + 14}
                  fontSize={12}
                  fontWeight="600"
                  fill={theme.text}
                  textAnchor="middle"
                >
                  {formatValue(v, spec.unit)}
                </SvgText>
              );
            })
          )}
        {isLine && selected != null && (
          <Line x1={cx(selected)} x2={cx(selected)} y1={top - 8} y2={bottom} stroke={chrome.axis} strokeWidth={1} />
        )}
        {isLine &&
          spec.series.map((s, j) => {
            let d = '';
            let pen = false;
            s.values.forEach((v, i) => {
              if (v == null) pen = false;
              else {
                d += `${pen ? 'L' : 'M'}${cx(i)},${y(v)}`;
                pen = true;
              }
            });
            return (
              <Path key={`l${j}`} d={d} stroke={colors[j]} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            );
          })}
        {isLine &&
          (selected == null
            ? ends.map((e) => <Circle key={`e${e.j}`} cx={cx(e.i)} cy={e.y} r={4} fill={colors[e.j]} stroke={theme.background} strokeWidth={2} />)
            : spec.series.map((s, j) => {
                const v = s.values[selected];
                return v == null ? null : (
                  <Circle key={`s${j}`} cx={cx(selected)} cy={y(v)} r={4.5} fill={colors[j]} stroke={theme.background} strokeWidth={2} />
                );
              }))}
        {isLine &&
          endLabels &&
          selected == null &&
          ends.map((e) => (
            <SvgText
              key={`el${e.j}`}
              x={Math.min(cx(e.i), width - 4)}
              y={e.y - 10}
              fontSize={12}
              fontWeight="600"
              fill={theme.text}
              textAnchor={cx(e.i) > width - 40 ? 'end' : 'middle'}
            >
              {formatValue(e.v, spec.unit)}
            </SvgText>
          ))}
      </Svg>

      {/* One tap target per category, the full band wide and the full plot tall. */}
      <View style={[StyleSheet.absoluteFill, styles.hits, { left }]}>
        {spec.labels.map((label, i) => (
          <Pressable
            key={i}
            style={{ width: band, height: PLOT_HEIGHT }}
            onPress={() => setSelected(selected === i ? null : i)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${spec.series
              .map((s) => `${s.name ? `${s.name} ` : ''}${s.values[i] == null ? 'no value' : formatValue(s.values[i]!, spec.unit)}`)
              .join(', ')}`}
          />
        ))}
      </View>

      {selected != null && (
        <View
          pointerEvents="none"
          style={[
            styles.readout,
            { backgroundColor: theme.surface, borderColor: theme.border },
            cx(selected) < width / 2 ? { left: cx(selected) + band / 2 + 4 } : { right: width - cx(selected) + band / 2 + 4 },
          ]}
        >
          <Text style={[styles.readoutTitle, { color: theme.text }]}>{spec.labels[selected]}</Text>
          {spec.series.map((s, j) => (
            <View key={j} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: colors[j] }]} />
              <Text style={[styles.readoutText, { color: theme.textSecondary }]}>
                {s.name ? `${s.name}  ` : ''}
                <Text style={{ color: theme.text, fontWeight: '600' }}>
                  {s.values[selected] == null ? '–' : formatValue(s.values[selected]!, spec.unit)}
                </Text>
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.xLabels, { marginLeft: left }]}>
        {spec.labels.map((label, i) => (
          <Text
            key={i}
            numberOfLines={2}
            style={[styles.xLabel, { width: band, color: theme.textSecondary }, band < 44 && i % 2 === 1 && styles.hidden]}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** A chart from a ```chart block's JSON; draws nothing if it doesn't parse. */
function ChartInner({ source }: { source: string }) {
  const { colors: theme, scheme } = useTheme();
  const { width: screen } = useWindowDimensions();
  // Starts at the width of a reply on this screen, so the chart has its height from the first
  // frame instead of popping in once measured; onLayout corrects it inside lists and quotes.
  const [width, setWidth] = useState(Math.max(0, screen - REPLY_GUTTER));
  const spec = useMemo(() => parseChart(source), [source]);
  const colors = SERIES[scheme];
  if (!spec) return null;
  // Long or many category names don't fit under columns; bars lay them out on their own lines.
  const horizontal =
    spec.type === 'hbar' || (spec.type === 'bar' && (spec.labels.length > 8 || spec.labels.some((l) => l.length > 18)));
  return (
    <View style={styles.container} onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
      {!!spec.title && <Text style={[styles.title, { color: theme.text }]}>{spec.title}</Text>}
      <Legend series={spec.series} colors={colors} />
      {width > 0 &&
        (horizontal ? <Bars spec={spec} width={width} colors={colors} /> : <Plot spec={spec} width={width} colors={colors} />)}
      {!!spec.caption && <Text style={[styles.caption, { color: theme.textTertiary }]}>{spec.caption}</Text>}
    </View>
  );
}

export const Chart = memo(ChartInner);

const styles = StyleSheet.create({
  container: { marginVertical: 12, gap: 10 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 13 },
  hits: { flexDirection: 'row' },
  readout: {
    position: 'absolute',
    top: 0,
    maxWidth: 220,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  readoutTitle: { fontSize: 13, fontWeight: '600' },
  readoutText: { fontSize: 13, flexShrink: 1 },
  xLabels: { flexDirection: 'row', marginTop: 6 },
  xLabel: { fontSize: 12, lineHeight: 16, textAlign: 'center', paddingHorizontal: 2 },
  hidden: { opacity: 0 },
  bars: { gap: 12 },
  barGroup: { gap: 4 },
  barLabel: { fontSize: 13, lineHeight: 18 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { height: 16, borderTopRightRadius: RADIUS, borderBottomRightRadius: RADIUS },
  value: { fontSize: 12 },
  caption: { fontSize: 13, lineHeight: 18 },
});
