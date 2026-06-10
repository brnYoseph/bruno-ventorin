const toggle = document.getElementById('menu-toggle');
const nav    = document.getElementById('nav-mobile');

toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!open));
  nav.hidden = open;
});

nav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', 'false');
    nav.hidden = true;
  });
});
