function getBannerContainer() {
  let container = document.getElementById("banner-container");

  if (!container) {
    container = document.createElement("div");
    container.id = "banner-container";

    document.body.appendChild(container);
  }

  return container;
}

function banneralert(text, type = "success", duration = 2500) {
  const container = getBannerContainer();

  const banner = document.createElement("div");
  banner.className = `banner ${type}`;
  banner.textContent = text;

  container.appendChild(banner);

  // animate in
  requestAnimationFrame(() => {
    banner.classList.add("show");
  });

  // remove
  setTimeout(() => {
    banner.classList.remove("show");

    setTimeout(() => {
      banner.remove();
    }, 250);
  }, duration);
}

window.banneralert = banneralert;