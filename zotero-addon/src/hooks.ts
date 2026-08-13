import { registerEndpoints, unregisterEndpoints } from "./modules/server";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  registerEndpoints();
  addon.data.initialized = true;
}

async function onMainWindowLoad(_win: Window): Promise<void> {}

async function onMainWindowUnload(_win: Window): Promise<void> {}

function onShutdown(): void {
  unregisterEndpoints();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error Plugin instances are attached dynamically by Zotero.
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
