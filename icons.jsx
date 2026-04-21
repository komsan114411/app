// Minimal line icons. Stroke-based, 24px.
function Icon({ name, size = 24, color = 'currentColor', stroke = 1.75 }) {
  const p = { fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    leaf: <><path {...p} d="M20 4c0 8-5 14-13 14 0-8 5-14 13-14Z"/><path {...p} d="M4 20c3-5 7-9 12-12"/></>,
    star: <path {...p} d="M12 3.5l2.6 5.4 5.9.9-4.3 4.2 1 5.9L12 17l-5.3 2.8 1-5.9L3.5 9.8l5.9-.9L12 3.5Z"/>,
    tag:  <><path {...p} d="M20.5 13.5l-7 7a2 2 0 0 1-2.8 0L3 13V4h9l8.5 8.5a1.4 1.4 0 0 1 0 2Z"/><circle {...p} cx="7.5" cy="7.5" r="1.2"/></>,
    book: <><path {...p} d="M4 4h9a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4Z"/><path {...p} d="M4 4v12a4 4 0 0 0 4 4"/></>,
    truck:<><path {...p} d="M3 7h11v10H3zM14 10h4l3 3v4h-7z"/><circle {...p} cx="7" cy="18.5" r="1.7"/><circle {...p} cx="17.5" cy="18.5" r="1.7"/></>,
    pin:  <><path {...p} d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z"/><circle {...p} cx="12" cy="9" r="2.5"/></>,
    heart:<path {...p} d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/>,
    gift: <><rect {...p} x="3.5" y="8" width="17" height="12" rx="1.5"/><path {...p} d="M3.5 12h17M12 8v12M8 8a2.5 2.5 0 0 1 0-5c2 0 4 3 4 5m0 0c0-2 2-5 4-5a2.5 2.5 0 0 1 0 5"/></>,
    calendar:<><rect {...p} x="3.5" y="5" width="17" height="15" rx="2"/><path {...p} d="M3.5 10h17M8 3v4M16 3v4"/></>,
    chat: <path {...p} d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/>,
    camera:<><path {...p} d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle {...p} cx="12" cy="13" r="3.5"/></>,
    music:<><path {...p} d="M9 18V6l11-2v12"/><circle {...p} cx="6" cy="18" r="3"/><circle {...p} cx="17" cy="16" r="3"/></>,
    sparkle:<><path {...p} d="M12 3v5M12 16v5M3 12h5M16 12h5"/><path {...p} d="M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/></>,

    // channels
    line: <><rect {...p} x="3.5" y="4" width="17" height="14" rx="4"/><path {...p} d="M8 9v4M8 13l3-4v4M13 9v4M13 9h2M13 11h2M13 13h2M16.5 9v4"/></>,
    messenger: <><path {...p} d="M12 3C7 3 3 7 3 11.5a8 8 0 0 0 3 6V21l3-1.5a10 10 0 0 0 3 .5c5 0 9-3.8 9-8.5S17 3 12 3Z"/><path {...p} d="M7.5 13l3-3 2.5 2 3.5-3.5"/></>,
    whatsapp: <><path {...p} d="M21 12a9 9 0 1 1-3.5-7.1L20 4l-1 4.5A9 9 0 0 1 21 12Z"/><path {...p} d="M9 9c0 3.5 2.5 6 6 6l1.5-1-2-1-1 1c-1.5-.5-2.5-1.5-3-3l1-1-1-2L9 9Z"/></>,
    phone: <path {...p} d="M21 17a2 2 0 0 1-2 2c-9 0-16-7-16-16a2 2 0 0 1 2-2h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 10l5 2v5Z"/>,
    email:<><rect {...p} x="3" y="5" width="18" height="14" rx="2"/><path {...p} d="M3 7l9 6 9-6"/></>,

    // UI
    plus: <path {...p} d="M12 5v14M5 12h14"/>,
    check:<path {...p} d="M5 13l4 4 10-10"/>,
    x:    <path {...p} d="M6 6l12 12M18 6L6 18"/>,
    chevronRight: <path {...p} d="M9 6l6 6-6 6"/>,
    chevronDown: <path {...p} d="M6 9l6 6 6-6"/>,
    drag: <><circle {...p} cx="9" cy="6" r=".5"/><circle {...p} cx="9" cy="12" r=".5"/><circle {...p} cx="9" cy="18" r=".5"/><circle {...p} cx="15" cy="6" r=".5"/><circle {...p} cx="15" cy="12" r=".5"/><circle {...p} cx="15" cy="18" r=".5"/></>,
    edit: <><path {...p} d="M4 20h4l10-10-4-4L4 16v4Z"/><path {...p} d="M14 6l4 4"/></>,
    trash:<><path {...p} d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></>,
    image:<><rect {...p} x="3.5" y="4.5" width="17" height="15" rx="2"/><circle {...p} cx="9" cy="10" r="1.5"/><path {...p} d="M4 18l5-5 4 4 2-2 5 5"/></>,
    upload:<><path {...p} d="M12 16V4M7 9l5-5 5 5M4 20h16"/></>,
    external:<><path {...p} d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path {...p} d="M14 4h6v6M20 4L11 13"/></>,
    eye:  <><path {...p} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle {...p} cx="12" cy="12" r="3"/></>,
    settings:<><circle {...p} cx="12" cy="12" r="3"/><path {...p} d="M20 12h1M3 12h1M12 3v1M12 20v1M18.4 5.6l-.7.7M6.3 17.7l-.7.7M18.4 18.4l-.7-.7M6.3 6.3l-.7-.7"/></>,
    bell: <><path {...p} d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Z"/><path {...p} d="M10 20a2 2 0 0 0 4 0"/></>,
    chart: <><path {...p} d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name] || paths.sparkle}
    </svg>
  );
}

window.Icon = Icon;
