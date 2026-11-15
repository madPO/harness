// Row renderer adapted from Herdr T3's t3-files/file-tree.js; see herdr/LICENSE.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { fileIcon, folderIcon } from "./file-icons.js";

// Pierre's compact density (factor 0.8): a 24 row; a level is its gap, the icon and the row's gap.
export const TREE_ROW = 24;
const PAD = 6.4, GAP = 4.8, LEVEL = 6.4 + 16 + GAP;
const CLEAR = "#00000000";
// A change's letter in its status's color, as T3's FileStatus.
const STATUS = { A: "#22c55e", D: "#ef4444", M: "#f59e0b", R: "#3b82f6", C: "#3b82f6" };

/**
 * One row, as Pierre's: a level's indent, a folder's chevron, the page's own `leading` (Review's reviewed box), the icon, the
 * name, then a change's letter and the page's own `trailing`. Selected on the text color at 12%, hovered at 7%; the row the keys are on ringed. `mod` is the mod's folder,
 * whose icons/ hold the chevrons and file-icons.js's; `icon`, a 16 element, stands in for the file or folder icon.
 */
/** @param {any} t @param {string} mod @param {any} row @param {string} id @param {{ selected?: boolean, focused?: boolean, status?: string, dim?: boolean, struck?: boolean, leading?: any, trailing?: any, icon?: any }} options */
export function treeRow(t, mod, row, id, { selected = false, focused = false, status, dim = false, struck = false, leading, trailing, icon } = {}) {
  return h_flex().id(id).h(TREE_ROW).mx(2).pl(PAD + row.depth * LEVEL).pr(PAD).gap(GAP).items_center().rounded(6).text_size(12)
    .border_1().border_color(focused ? t.ring : CLEAR)
    .when(selected, (el) => el.bg(t.foreground + "1f")).when(!selected, (el) => el.hover((s) => s.bg(t.foreground + "12")))
    .child(div().size(16).flex_none().flex().items_center().justify_center()
      .when(Boolean(row.dir), (el) => el.child(svg(`${mod}/icons/chevron-${row.open ? "down" : "right"}.svg`).size(12).text_color(t.dim))))
    .when(Boolean(leading), (el) => el.child(leading))
    .child((icon ?? image(`${mod}/${row.dir ? folderIcon(row.path, row.open) : fileIcon(row.path)}`).size(16).flex_none()).when(dim, (el) => el.opacity(0.5)))
    .child(div().flex_1().min_w(0).truncate().when(dim, (el) => el.opacity(0.5)).when(struck, (el) => el.line_through()).child(row.name))
    .when(Boolean(status), (el) => el.child(statusBadge(status)))
    .when(Boolean(trailing), (el) => el.child(trailing));
}

// The letter in its status's color, on a tenth of it; T3's sm Badge.
export function statusBadge(letter) {
  const color = STATUS[letter] ?? STATUS.M;
  return div().h(16).min_w(16).px(3).flex_none().flex().items_center().justify_center().rounded(4).font_medium().text_size(10).text_color(color).bg(color + "1a").child(letter);
}
