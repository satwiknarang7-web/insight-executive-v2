/**
 * Geometry for the entity-relationship diagram.
 *
 * Kept out of the component for the usual reason — JSX cannot be imported by
 * the test runner — but also because the layout is the part that was wrong.
 * The first version derived node positions from `factTable`, so promoting a
 * table re-ran the layout and every card on screen jumped to a new place. A
 * diagram that rearranges itself when you touch it is unusable; positions are
 * seeded once here and owned by the user from then on.
 */

/** Card geometry, shared with the component so hit areas match what is drawn. */
export const CARD_W = 210;
export const HEADER_H = 30;
export const ROW_H = 19;
export const CARD_PAD = 8;
export const MAX_ROWS = 12;
export const COL_GAP = 110;
export const ROW_GAP = 44;

/** How tall a table's card is, given how many columns it shows. */
export function cardHeight(columnCount) {
  return HEADER_H + Math.min(columnCount, MAX_ROWS) * ROW_H + CARD_PAD * 2;
}

/** The vertical centre of one column row, relative to the card's top edge. */
export function rowCentre(index) {
  return HEADER_H + CARD_PAD + index * ROW_H + ROW_H / 2;
}

/**
 * Which columns of a table are keys.
 *
 * A primary key is whatever other tables point AT; a foreign key is whatever
 * this table points out with. A table nobody references falls back to an
 * id-shaped column, which is what the inference itself keys on.
 */
export function keyRoles(tableName, columns, relationships) {
  const primary = new Set();
  const foreign = new Set();

  for (const rel of relationships || []) {
    if (rel.to?.table === tableName) primary.add(rel.to.column);
    if (rel.from?.table === tableName) foreign.add(rel.from.column);
  }

  if (primary.size === 0) {
    const idLike = (columns || []).find((c) => /^id$|_id$|^key$|^code$/i.test(String(c)));
    if (idLike && !foreign.has(idLike)) primary.add(idLike);
  }

  return { primary, foreign };
}

/**
 * Order a table's columns so the keys are visible without scrolling.
 *
 * Keys first, then everything else in its original order. A card that truncates
 * at twelve rows must not hide the very columns the joins are drawn from.
 */
export function orderedColumns(columns, { primary, foreign }) {
  const keys = [];
  const rest = [];
  for (const c of columns || []) {
    if (primary.has(c) || foreign.has(c)) keys.push(c);
    else rest.push(c);
  }
  return [...keys, ...rest];
}

/**
 * How far each table sits from the fact table, following relationships outward.
 *
 * Depth drives the column a card lands in, which is what gives the diagram its
 * left-to-right reading order: facts on the left, the things they look up to
 * the right of them.
 */
export function depths(tableNames, factTable, relationships) {
  const out = new Map();
  if (!tableNames.length) return out;

  const root = factTable && tableNames.includes(factTable) ? factTable : tableNames[0];
  out.set(root, 0);

  // Breadth-first along edges in either direction, so a chain of lookups lands
  // in successive columns rather than all piling into one.
  let frontier = [root];
  while (frontier.length) {
    const next = [];
    for (const name of frontier) {
      for (const rel of relationships || []) {
        const pairs = [
          [rel.from?.table, rel.to?.table],
          [rel.to?.table, rel.from?.table],
        ];
        for (const [a, b] of pairs) {
          if (a === name && b && !out.has(b)) {
            out.set(b, out.get(name) + 1);
            next.push(b);
          }
        }
      }
    }
    frontier = next;
  }

  // Anything unreachable is parked in its own column past the rest.
  const maxDepth = Math.max(0, ...out.values());
  for (const name of tableNames) {
    if (!out.has(name)) out.set(name, maxDepth + 1);
  }
  return out;
}

/**
 * Seed positions for every table: columns by depth, stacked within a column.
 *
 * Deterministic, so the same model always opens the same way — but only ever
 * used as a starting point, never re-applied while the user is looking at it.
 */
export function seedPositions(tables, factTable, relationships) {
  const names = tables.map((t) => t.name);
  const byDepth = depths(names, factTable, relationships);

  const columns = new Map();
  for (const table of tables) {
    const d = byDepth.get(table.name) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d).push(table);
  }

  const positions = {};
  const sortedDepths = [...columns.keys()].sort((a, b) => a - b);

  sortedDepths.forEach((depth, columnIndex) => {
    const group = columns.get(depth);
    let y = 0;
    for (const table of group) {
      positions[table.name] = {
        x: columnIndex * (CARD_W + COL_GAP),
        y,
      };
      y += cardHeight(table.columnCount ?? table.columns?.length ?? 0) + ROW_GAP;
    }
  });

  // Centre each column vertically against the tallest one, so the diagram does
  // not read as top-heavy.
  const heightOf = (group) =>
    group.reduce(
      (sum, t) => sum + cardHeight(t.columnCount ?? t.columns?.length ?? 0) + ROW_GAP,
      -ROW_GAP
    );
  const tallest = Math.max(...sortedDepths.map((d) => heightOf(columns.get(d))), 0);
  for (const depth of sortedDepths) {
    const offset = (tallest - heightOf(columns.get(depth))) / 2;
    for (const table of columns.get(depth)) positions[table.name].y += offset;
  }

  return positions;
}

/** The canvas the given cards need, with room to drag them around in. */
export function canvasSize(tables, positions) {
  let maxX = 0;
  let maxY = 0;
  for (const table of tables) {
    const p = positions[table.name];
    if (!p) continue;
    maxX = Math.max(maxX, p.x + CARD_W);
    maxY = Math.max(maxY, p.y + cardHeight(table.columnCount ?? table.columns?.length ?? 0));
  }
  return { width: maxX + 80, height: maxY + 80 };
}

/**
 * An orthogonal connector between two column rows, routed around the cards.
 *
 * Straight diagonals cross card bodies and become unreadable the moment there
 * are more than three tables; a stepped path leaves the side of one card and
 * arrives at the side of the other, which is how every ER tool draws them.
 */
export function connectorPath(from, to) {
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
}

/** Which side of each card a connector should leave from and arrive at. */
export function anchorSides(fromCard, toCard) {
  return fromCard.x + CARD_W / 2 <= toCard.x + CARD_W / 2
    ? { fromSide: 'right', toSide: 'left' }
    : { fromSide: 'left', toSide: 'right' };
}
