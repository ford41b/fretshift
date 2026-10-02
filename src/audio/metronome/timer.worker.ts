let timer: ReturnType<typeof setInterval> | undefined;
self.onmessage = (event: MessageEvent<"start" | "stop">) => {
  if (timer) clearInterval(timer);
  if (event.data === "start")
    timer = setInterval(() => self.postMessage("tick"), 25);
};
export {};
