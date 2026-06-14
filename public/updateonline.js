function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function update_online() {
  while (true) {
    await fetch("/api/user/online", {
      method: "POST",
    });

    await delay(10000); // 10 seconds
  }
}

update_online();