declare module "menubar" {
  import { BrowserWindow, Tray } from "electron";

  export interface MenubarOptions {
    index?: string | boolean;
    dir?: string;
    preloadWindow?: boolean;
    browserWindow?: any;
    tray?: Tray;
  }

  export interface Menubar {
    app: Electron.App;
    window: BrowserWindow;
    tray: Tray;
    showWindow(): void;
    hideWindow(): void;
  }

  export function menubar(options?: MenubarOptions): Menubar;
}
