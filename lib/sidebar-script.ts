/** Shared by the server layout (inline pre-paint script) and the client hook in lib/sidebar.ts. */
export const SIDEBAR_STORAGE_KEY = "lge-sidebar-collapsed";

/** Applies the saved collapse preference to <html> before first paint. */
export const SIDEBAR_INIT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})==="1")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;
