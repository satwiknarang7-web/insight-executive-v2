'use client';

/**
 * The data model as an entity-relationship diagram.
 *
 * The list below this carries more detail, but a list cannot answer the
 * question people arrive with — "what is joined to what, on which column?" —
 * without being read end to end and assembled in your head. The diagram answers
 * it at a glance and makes the two failures that matter visible rather than
 * inferable: a table sitting alone with no connectors (not being analysed at
 * all), and a connector that matched almost nothing (numbers computed over a
 * join that did not work).
 *
 * It is an editor, not an illustration. Clicking a card's header promotes that
 * table to the fact table; clicking a connector switches that join off. Both
 * feed the same pending-edit state as the list, so the two views cannot
 * disagree and there is still exactly one Apply.
 *
 * **Positions are seeded once and then belong to the user.** The first version
 * derived them from `factTable`, so promoting a table re-ran the layout and
 * every card jumped somewhere new — the diagram appeared to move on its own.
 * Now the seed runs only when the set of tables actually changes; nothing else
 * on this screen can move a card except dragging it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Hand, KeyRound, Link2Off, Maximize2, Minimize2, Star } from 'lucide-react';
import { POOR_MATCH } from '../../lib/dataModel';
import {
  CARD_W,
  HEADER_H,
  ROW_H,
  MAX_ROWS,
  CARD_PAD,
  FOOTER_H,
  cardHeight,
  footerBaseline,
  isTruncated,
  rowCentre,
  keyRoles,
  orderedColumns,
  seedPositions,
  canvasSize,
  connectorPath,
  anchorSides,
} from '../../lib/erLayout';

const clip = (s, max) => {
  const text = String(s ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * How far the pointer must travel before a press counts as a drag.
 *
 * A click and a drag begin identically, and a card that promotes itself to fact
 * table because your hand moved two pixels is worse than one that insists on a
 * deliberate click. Anything under this is a click.
 */
const DRAG_SLOP = 3;

/** A stable identity for "which tables am I looking at". */
const signatureOf = (tables) =>
  tables
    .map((t) => t.name)
    .sort()
    .join('\u0000');

export default function RelationshipGraph({
  tables = [],
  relationships = [],
  joins = [],
  factTable,
  disabled,
  onToggleRelationship,
  onSetFactTable,
}) {
  const svgRef = useRef(null);
  // Whether the press in progress has become a drag.
  //
  // A ref rather than state, and that is the whole fix for cards promoting
  // themselves: `pointerup` clears the drag before the browser dispatches the
  // `click`, so by the time the header's handler runs the state says "no drag"
  // however far the card was just dragged. A ref outlives that render and still
  // remembers.
  const movedRef = useRef(false);
  const [positions, setPositions] = useState({});
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const signature = signatureOf(tables);

  // Seed only when the tables themselves change. Deliberately NOT keyed on
  // factTable or relationships: those change as the user edits, and re-seeding
  // on them is exactly the bug this replaced.
  useEffect(() => {
    setPositions(seedPositions(tables, factTable, relationships));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // An overlay rather than the Fullscreen API: it keeps the app's own theme and
  // cannot be refused by the browser, and Escape is the exit everyone reaches
  // for anyway. Scrolling the page underneath is locked while it is open.
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  const columnsFor = useMemo(() => {
    const map = {};
    for (const table of tables) {
      const cols = table.columns || [];
      const roles = keyRoles(table.name, cols, relationships);
      map[table.name] = { roles, ordered: orderedColumns(cols, roles) };
    }
    return map;
  }, [tables, relationships]);

  const matchRateFor = useCallback(
    (rel) => {
      const join = joins.find((j) => j.from?.table === rel.from.table && j.to?.table === rel.to.table);
      return join ? join.matchRate : null;
    },
    [joins]
  );

  /** Client coordinates into the SVG's own coordinate space. */
  const toSvg = useCallback((event) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const startDrag = useCallback(
    (name, event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      const at = toSvg(event);
      const current = positions[name] || { x: 0, y: 0 };
      movedRef.current = false;
      setDrag({ name, grabX: at.x - current.x, grabY: at.y - current.y, fromX: at.x, fromY: at.y });
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [toSvg, positions]
  );

  const onDragMove = useCallback(
    (event) => {
      if (!drag) return;
      const at = toSvg(event);
      if (Math.abs(at.x - drag.fromX) > DRAG_SLOP || Math.abs(at.y - drag.fromY) > DRAG_SLOP) {
        movedRef.current = true;
      }
      // Below the threshold nothing moves at all, so a click cannot nudge a card
      // a pixel on its way to doing something else.
      if (!movedRef.current) return;
      setPositions((prev) => ({
        ...prev,
        [drag.name]: { x: Math.max(0, at.x - drag.grabX), y: Math.max(0, at.y - drag.grabY) },
      }));
    },
    [drag, toSvg]
  );

  const endDrag = useCallback(() => setDrag(null), []);

  const size = useMemo(() => canvasSize(tables, positions), [tables, positions]);

  if (tables.length < 2 || !Object.keys(positions).length) return null;

  /** Where a connector should attach on a card, in canvas coordinates. */
  const anchorFor = (tableName, column, side) => {
    const card = positions[tableName];
    const info = columnsFor[tableName];
    if (!card || !info) return null;
    const index = info.ordered.indexOf(column);
    const shown = Math.min(info.ordered.length, MAX_ROWS);
    // A key hidden past the truncation still needs an anchor; the card edge
    // beside the last visible row is the honest place for it.
    const y = card.y + (index >= 0 && index < shown ? rowCentre(index) : HEADER_H / 2);
    return { x: side === 'right' ? card.x + CARD_W : card.x, y };
  };

  return (
    <div className={expanded ? 'fixed inset-0 z-50 flex flex-col bg-canvas p-4' : 'card p-4'}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="label">Relationship map</span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/35">
          <Hand size={11} /> drag a table to move it
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/35">
          <Star size={11} /> click a title to make it the fact table
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/35">
          <Link2Off size={11} /> click a connector to switch it off
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPositions(seedPositions(tables, factTable, relationships))}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 min-h-11 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] sm:min-h-0 text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Crosshair size={11} /> Tidy up
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-pressed={expanded}
            title={expanded ? 'Leave full screen (Esc)' : 'Expand to the full screen'}
            className="flex items-center gap-1.5 rounded-lg border border-accent-500/25 bg-accent-500/8 min-h-11 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] sm:min-h-0 text-accent-300 transition-colors hover:bg-accent-500/15"
          >
            {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            {expanded ? 'Exit full screen' : 'Full screen'}
          </button>
        </div>
      </div>

      <div
        className={`overflow-auto rounded-xl border border-white/6 bg-canvas-raised ${expanded ? 'min-h-0 flex-1' : ''}`}
        style={expanded ? undefined : { maxHeight: 560 }}
      >
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          viewBox={`-40 -40 ${size.width} ${size.height}`}
          className="touch-none select-none"
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          role="img"
          aria-label="Entity relationship diagram of the loaded tables"
        >
          {/* Connectors first, so cards sit on top of them. */}
          {relationships.map((rel) => {
            const off = disabled.has(rel.id);
            const fromCard = positions[rel.from.table];
            const toCard = positions[rel.to.table];
            if (!fromCard || !toCard) return null;

            const { fromSide, toSide } = anchorSides(fromCard, toCard);
            const a = anchorFor(rel.from.table, rel.from.column, fromSide);
            const b = anchorFor(rel.to.table, rel.to.column, toSide);
            if (!a || !b) return null;

            const rate = matchRateFor(rel);
            const poor = rate !== null && rate < POOR_MATCH;
            const stroke = off
              ? 'var(--chart-axis)'
              : poor
              ? 'var(--color-amber-400)'
              : 'var(--color-accent-500)';
            const isHovered = hover === rel.id;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

            return (
              <g
                key={rel.id}
                className="cursor-pointer"
                onClick={() => onToggleRelationship(rel.id)}
                onMouseEnter={() => setHover(rel.id)}
                onMouseLeave={() => setHover((h) => (h === rel.id ? null : h))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggleRelationship(rel.id)}
                aria-label={`${off ? 'Enable' : 'Disable'} the join from ${rel.from.table}.${rel.from.column} to ${rel.to.table}.${rel.to.column}`}
              >
                <path d={connectorPath(a, b)} stroke="transparent" strokeWidth={16} fill="none" />
                <path
                  d={connectorPath(a, b)}
                  stroke={stroke}
                  strokeWidth={isHovered ? 2.5 : 1.6}
                  strokeOpacity={off ? 0.4 : 0.95}
                  strokeDasharray={off ? '5 5' : undefined}
                  fill="none"
                />
                {/* Crow's foot at the many end, a bar at the one end — the
                    notation the reference diagram uses. */}
                <CrowsFoot x={a.x} y={a.y} side={fromSide} stroke={stroke} />
                <OneBar x={b.x} y={b.y} side={toSide} stroke={stroke} />

                {(isHovered || off || poor) && (
                  <g transform={`translate(${mid.x}, ${mid.y})`} pointerEvents="none">
                    <rect x={-52} y={-11} width={104} height={22} rx={7} fill="var(--surface)" stroke={stroke} strokeOpacity={0.55} />
                    <text textAnchor="middle" y={4} fontSize={9} fontWeight={800} fill={stroke}>
                      {off ? 'switched off' : rate === null ? 'many to one' : `${Math.round(rate * 100)}% matched`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Cards */}
          {tables.map((table) => {
            const p = positions[table.name];
            const info = columnsFor[table.name];
            if (!p || !info) return null;

            const isFact = table.name === factTable;
            const connected = relationships.some(
              (r) => !disabled.has(r.id) && (r.from.table === table.name || r.to.table === table.name)
            );
            const headerFill = isFact
              ? 'var(--color-accent-500)'
              : connected
              ? 'var(--color-accent-700)'
              : 'var(--color-amber-500)';
            const shown = info.ordered.slice(0, MAX_ROWS);
            const h = cardHeight(info.ordered.length);

            return (
              <g key={table.name} transform={`translate(${p.x}, ${p.y})`}>
                <rect
                  width={CARD_W}
                  height={h}
                  rx={8}
                  fill="var(--surface)"
                  stroke={isFact ? 'var(--color-accent-500)' : 'var(--card-border)'}
                  strokeWidth={isFact ? 2 : 1}
                />

                {/* Header: the drag handle, and the fact-table control. */}
                <g
                  className="cursor-grab"
                  onPointerDown={(e) => startDrag(table.name, e)}
                  onClick={() => {
                    // The click that ends a drag is still a click. Swallow it,
                    // and clear the flag so the next real one is honoured.
                    if (movedRef.current) {
                      movedRef.current = false;
                      return;
                    }
                    if (!isFact) onSetFactTable(table.name);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSetFactTable(table.name)}
                  aria-label={`${table.name}${isFact ? ', the fact table' : '. Press enter to make it the fact table'}`}
                >
                  <path
                    d={`M 0 8 a 8 8 0 0 1 8 -8 h ${CARD_W - 16} a 8 8 0 0 1 8 8 v ${HEADER_H - 8} h ${-CARD_W} z`}
                    fill={headerFill}
                  />
                  <text x={10} y={20} fontSize={12} fontWeight={800} fill="#ffffff">
                    {clip(table.name, 22)}
                  </text>
                  {isFact && (
                    <text x={CARD_W - 10} y={20} fontSize={9} fontWeight={900} textAnchor="end" fill="#ffffff" opacity={0.9}>
                      FACT
                    </text>
                  )}
                </g>

                {/* Columns, keys first. */}
                {shown.map((col, i) => {
                  const isPk = info.roles.primary.has(col);
                  const isFk = info.roles.foreign.has(col);
                  const y = rowCentre(i);
                  return (
                    <g key={col}>
                      {(isPk || isFk) && (
                        <rect
                          x={4}
                          y={y - ROW_H / 2 + 1}
                          width={CARD_W - 8}
                          height={ROW_H - 2}
                          rx={4}
                          fill={isPk ? 'var(--color-accent-500)' : 'var(--color-amber-500)'}
                          fillOpacity={0.1}
                        />
                      )}
                      <text
                        x={isPk || isFk ? 26 : 12}
                        y={y + 3.5}
                        fontSize={10.5}
                        fontWeight={isPk || isFk ? 800 : 600}
                        fill={isPk || isFk ? 'var(--color-white)' : 'var(--chart-axis)'}
                      >
                        {clip(col, 22)}
                      </text>
                      {(isPk || isFk) && (
                        <text x={11} y={y + 3.5} fontSize={9} textAnchor="middle" fill={isPk ? 'var(--color-accent-400)' : 'var(--color-amber-400)'}>
                          {isPk ? '⚿' : '⚑'}
                        </text>
                      )}
                    </g>
                  );
                })}

                {isTruncated(info.ordered.length) && (
                  <g>
                    {/* Its own strip below the last row, ruled off — not a line
                        painted into the bottom padding on top of a column name,
                        which is what it was. */}
                    <line
                      x1={8}
                      x2={CARD_W - 8}
                      y1={h - CARD_PAD - FOOTER_H}
                      y2={h - CARD_PAD - FOOTER_H}
                      stroke="var(--card-border)"
                      strokeWidth={1}
                    />
                    <text
                      x={12}
                      y={footerBaseline(info.ordered.length)}
                      fontSize={9}
                      fontWeight={700}
                      fill="var(--chart-axis)"
                      opacity={0.7}
                    >
                      +{info.ordered.length - MAX_ROWS} more columns
                    </text>
                  </g>
                )}

                {/* Source line, the way the reference diagram names the engine. */}
                <text x={0} y={h + 14} fontSize={9} fontWeight={700} fill="var(--chart-axis)" opacity={0.75}>
                  {clip(sourceLabel(table), 34)}
                </text>
                {!connected && (
                  <text x={0} y={h + 26} fontSize={9} fontWeight={800} fill="var(--color-amber-400)">
                    not joined — excluded
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-white/40">
        <span className="flex items-center gap-1.5">
          <KeyRound size={11} className="text-accent-400" /> primary key
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-amber-400">⚑</span> foreign key
        </span>
        <span>
          The fork marks the &ldquo;many&rdquo; end. An amber connector matched few rows — the numbers built on
          it are only as good as that match.
        </span>
      </div>
    </div>
  );
}

/** The three prongs that mark the "many" end of a relationship. */
function CrowsFoot({ x, y, side, stroke }) {
  const dir = side === 'right' ? 1 : -1;
  const tip = x + dir * 12;
  return (
    <g stroke={stroke} strokeWidth={1.4} fill="none" pointerEvents="none">
      <line x1={x} y1={y} x2={tip} y2={y - 5} />
      <line x1={x} y1={y} x2={tip} y2={y} />
      <line x1={x} y1={y} x2={tip} y2={y + 5} />
    </g>
  );
}

/** The single bar that marks the "one" end. */
function OneBar({ x, y, side, stroke }) {
  const dir = side === 'right' ? 1 : -1;
  const at = x + dir * 8;
  return (
    <line x1={at} y1={y - 5} x2={at} y2={y + 5} stroke={stroke} strokeWidth={1.8} pointerEvents="none" />
  );
}

/** Where this table came from — the sheet, the file, or just its row count. */
function sourceLabel(table) {
  if (table.sheetName && table.sourceFile) return `${table.sourceFile} · ${table.sheetName}`;
  return table.sourceFile || table.sheetName || `${(table.rowCount || 0).toLocaleString()} rows`;
}


