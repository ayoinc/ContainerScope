"use strict";
/*
  Router for the content layer. Top-level sections mirror the native sidebar;
  `container/<id>` is a drill-in under Containers (HIG Sidebars: ≤ 2 levels).
*/
CS.app = {
  route: null,
  view: null,

  navigate(route) {
    if (route === this.route) return;
    const [section, param] = route.split("/");
    const factory = section === "container" ? CS.views.container : CS.views[section];
    if (!factory) return;
    this.view?.destroy();
    this.route = route;
    const root = document.getElementById("app");
    root.scrollTop = 0;
    this.view = factory(root, param && decodeURIComponent(param));
    const sidebarRoute = section === "container" ? "containers" : section;
    CS.call("route", { name: sidebarRoute }).catch(() => {});
  },

  refresh() { return CS.store.refreshAll(); },
};
window.app = CS.app; // native menu/sidebar entry point
CS.store.subscribe((topic) => CS.app.view?.update(topic));
CS.store.start();
// The sidebar owns the route; a fresh page (launch or WebContent restart) asks for it.
CS.call("currentRoute").then((route) => CS.app.navigate(route || "overview"), () => CS.app.navigate("overview"));
