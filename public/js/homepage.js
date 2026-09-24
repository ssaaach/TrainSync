// homepage.html — public landing. Shows the user menu when logged in.
TS.hideNavbarOnScroll();

document.addEventListener('DOMContentLoaded', async () => {
  const navLogin = document.getElementById('nav-login');
  const sidebar = document.getElementById('sidebar');

  const session = await TS.getSession();
  if (session.loggedIn) {
    navLogin.innerHTML = `<a href="#" id="user-menu-toggle">☰ ${TS.escapeHTML(session.email)}</a>`;

    document.getElementById('user-menu-toggle').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      sidebar.style.display = sidebar.style.display === 'block' ? 'none' : 'block';
    });

    document.getElementById('logout-btn').addEventListener('click', e => {
      e.preventDefault();
      TS.logout('homepage.html');
    });
  }

  // Close the menu when clicking outside it.
  document.addEventListener('click', e => {
    if (!sidebar.contains(e.target)) sidebar.style.display = 'none';
  });
});
