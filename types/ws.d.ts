// ws@8 не тянет свои типы — минимальное ambient-объявление (без сети).
declare module 'ws' {
  export const WebSocketServer: any
  export const WebSocket: any
}
