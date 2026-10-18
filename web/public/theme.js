// Pick the theme before the first paint so the page never flashes the wrong one
// (Strategy › Appearance saves it; "system" follows the device)
(function () {
  var theme = 'dark'
  try {
    var pref = localStorage.getItem('theme') || 'system'
    theme = pref === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : pref
  } catch { /* storage unavailable: dark */ }
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#F7F4EC' : '#0F1226'
})()
