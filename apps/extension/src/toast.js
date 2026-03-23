let container = null;

function ensureContainer() {
  if (container) {
    return container;
  }

  container = document.createElement("section");
  container.className = "toastViewport";
  document.body.append(container);
  return container;
}

export function showToast(message, type = "default") {
  const viewport = ensureContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  viewport.append(toast);

  requestAnimationFrame(() => {
    toast.dataset.open = "true";
  });

  const removeToast = () => {
    toast.dataset.open = "false";
    window.setTimeout(() => {
      toast.remove();
      if (viewport.childElementCount === 0) {
        viewport.remove();
        container = null;
      }
    }, 180);
  };

  window.setTimeout(removeToast, 2600);
  return removeToast;
}
