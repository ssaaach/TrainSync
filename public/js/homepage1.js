// homepage1.html — logged-in landing. Logged-out visitors go to the login page.
TS.hideNavbarOnScroll();

document.addEventListener('DOMContentLoaded', async () => {
  const session = await TS.requireLogin();
  if (session.onboardingComplete === false) {
    location.replace('/onboarding.html');
    return;
  }

  const sidebar = document.getElementById('sidebar');

  // The menu starts open (as designed); the ☰ toggles it.
  document.getElementById('user-menu-toggle').addEventListener('click', e => {
    e.preventDefault();
    sidebar.style.display = sidebar.style.display === 'none' ? '' : 'none';
  });

  document.getElementById('logout-btn').addEventListener('click', e => {
    e.preventDefault();
    TS.logout('homepage.html');
  });
});
