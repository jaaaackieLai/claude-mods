/** 一件正在處理的工作。狀態不另外存：最上層是進行中，其他是暫停 */
export type WorkItem = { id: string; title: string }

/** 工作堆疊，加上用過的最大 id 編號。lastId 讓收掉或刪除的 id 不再重用 */
export type Stack = { items: WorkItem[]; lastId: number }

/** 收支線後的回主線提醒：id 和 returnTo 是主線的 id 和標題，left 是剛離開的支線標題 */
export type Reminder = { id: string; returnTo: string; left: string }

declare module 'claude-code' {
  interface PluginState {
    'gold-fish': {
      /** 工作堆疊。items 最底層在前，最上層（目前的工作項）在後 */
      stack: Stack
      /** 回主線提醒，沒有提醒時是 null。只放在 $.state，不寫檔 */
      reminder: Reminder | null
      /** stack 屬於哪個 session。null 代表還沒讀檔，或工作堆疊檔無法解析 */
      loaded: string | null
    }
  }
}
