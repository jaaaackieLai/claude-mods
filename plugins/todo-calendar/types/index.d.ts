export type Task = {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string
  done: boolean
  /** ISO 8601 */
  createdAt: string
}

/** 面板上選取的任務：menu 顯示操作列，edit 顯示輸入框，confirm 等待確認刪除 */
export type Selection = {
  id: string
  mode: 'menu' | 'edit' | 'confirm'
  /** 編輯中的名稱草稿 */
  title: string
  /** 編輯中的日期草稿 */
  date: string
  /** 編輯時的錯誤訊息，沒有錯誤時是空字串 */
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'todo-calendar': {
      /** 從任務檔讀到的任務，定時同步 */
      tasks: Task[]
      /** 相對於本週的週數：0 本週，-1 上一週，1 下一週 */
      weekOffset: number
      /** 今天的日期 YYYY-MM-DD，換日時更新以觸發重畫 */
      today: string
      /** 面板上選取的任務，沒有選取時是 null */
      selection: Selection | null
    }
  }
}
