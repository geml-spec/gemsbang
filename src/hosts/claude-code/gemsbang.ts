// The gemsbang mark, as the pane and the line above the prompt draw it. Pure
// and Node-free: the hooks module imports this file.

/** The mark: a speech bubble holding a gem, on a blue disc, with the red dot of something new. */
export const GEMSBANG_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="gb" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="64"><stop offset="0" stop-color="#42b4f4"/><stop offset="1" stop-color="#0a74c0"/></linearGradient></defs><circle cx="32" cy="32" r="32" fill="url(#gb)"/><path d="M20 16H44A6 6 0 0 1 50 22V38A6 6 0 0 1 44 44H28L17 53L19 44H20A6 6 0 0 1 14 38V22A6 6 0 0 1 20 16Z" fill="#fff"/><path d="M26 23H38L43 29L32 40L21 29Z" fill="url(#gb)"/><path d="M21 29H43M26 23l6 6 6-6M32 29v11" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><circle cx="52" cy="12" r="8" fill="#ef3b3f" stroke="#fff" stroke-width="2.5"/></svg>';
/** The mark where the surface draws no pictures: one character in the mark's blue. */
export const GEMSBANG_MARK_CHAR = "@";
export const GEMSBANG_BLUE = "#0a74c0";
