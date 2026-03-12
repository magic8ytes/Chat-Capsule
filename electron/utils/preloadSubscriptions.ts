export type IpcSubscriptionListener = (...args: unknown[]) => void

export interface IpcRendererSubscriptionLike {
  on: (channel: string, listener: IpcSubscriptionListener) => void
  removeListener: (channel: string, listener: IpcSubscriptionListener) => void
}

export function subscribeIpcPayload<T>(
  ipc: IpcRendererSubscriptionLike,
  channel: string,
  callback: (payload: T) => void
): () => void {
  const listener = (((_event: unknown, payload: T) => callback(payload)) as unknown) as IpcSubscriptionListener
  ipc.on(channel, listener)
  return () => ipc.removeListener(channel, listener)
}

export function subscribeIpcEvent<T>(
  ipc: IpcRendererSubscriptionLike,
  channel: string,
  callback: (event: unknown, payload: T) => void
): () => void {
  const listener = (((event: unknown, payload: T) => callback(event, payload)) as unknown) as IpcSubscriptionListener
  ipc.on(channel, listener)
  return () => ipc.removeListener(channel, listener)
}
