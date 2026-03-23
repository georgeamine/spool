import React from "react";
import { getRecordingsPageUrl } from "../lib/navigation.js";

function NavTab({ active, href, label }) {
  return (
    <a className="navTab" data-active={active ? "true" : "false"} href={href}>
      {label}
    </a>
  );
}

function Breadcrumb({ currentLabel }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <a className="breadcrumbLink" href={getRecordingsPageUrl()}>
        Manage recordings
      </a>
      <span className="breadcrumbDivider" aria-hidden="true">
        /
      </span>
      <span className="breadcrumbCurrent">{currentLabel}</span>
    </nav>
  );
}

export function AppLayout({
  activeNav,
  title,
  subtitle,
  actions,
  children
}) {
  return (
    <main className="appShell">
      <header className="appHeader">
        <div className="brandLockup">
          <p className="brandEyebrow">Spool</p>
          <h1 className="brandTitle">{title}</h1>
          {subtitle ? <p className="brandSubtle">{subtitle}</p> : null}
        </div>
        <div className="appHeaderActions">
          {activeNav === "detail" ? (
            <Breadcrumb currentLabel="Recording detail" />
          ) : activeNav === "recordings" ? null : (
            <nav className="navTabs" aria-label="Primary">
              <NavTab active={activeNav === "recordings"} href={getRecordingsPageUrl()} label="Manage recordings" />
            </nav>
          )}
          {actions}
        </div>
      </header>
      <section className="pageGrid">{children}</section>
    </main>
  );
}
