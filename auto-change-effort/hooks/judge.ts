// 判定の部品。フックからは呼ばれるだけで、$ には触らない

export type Level = 'low' | 'medium' | 'high' | 'xhigh'

// 低い順。max は選ばない(D-012)
export const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh']

// Haiku に渡す依頼と前の回答の長さ(文字数)
export const REQUEST_LIMIT = 1000
export const PREVIOUS_LIMIT = 400

// 判定基準(D-017・D-018)。Haiku の system に渡す
export const RULES = `あなたは、コーディング支援の AI に届いた依頼を読み、どれだけ深く考えさせるかを4段階から選ぶ係です。
深く考えさせるほど費用と時間がかかります。足りなければ後から引き上げられるので、2つの段階で迷ったら必ず低い方を選んでください。

low:
- 用語・仕組み・使い方を聞くだけの質問
- あいさつ、お礼、短い相づち
- 手順が決まっている短い作業(コミット、ファイルの移動や名前の変更など)

medium:
- コードの説明、調べもの
- 差分のレビュー
- エラー文が出ている不具合の原因調査(エラー文から場所の見当がつく)
- 範囲がはっきりした小さな変更

high:
- 原因の手がかりがない不具合(たまにしか起きない、エラーが出ない)
- 設計案の比較、あいまいな要件の整理
- プロジェクト全体から該当する箇所を洗い出す
- 設計を根本から見直す、長い時間ひとりで進める作業

xhigh:
- プロジェクト全体の監査、全体の移行
- セキュリティ、データの消失、並行処理に関わる作業
- 直したはずなのに直らない不具合

依頼が「2」「Bで」のように、前の回答に並んだ選択肢から1つを選ぶだけの短い返事なら、返事そのものではなく、選ばれた選択肢の作業がどれだけ重いかで選んでください。

返事は low / medium / high / xhigh のどれか1語だけにしてください。説明は要りません。`

// Haiku に渡す本文。前の回答の末尾は、短い返事(「2」「OK」など)が何を指すかを読むために添える
export function buildPrompt(request: string, previous?: string): string {
  const parts: string[] = []
  if (previous) {
    parts.push(`<前の回答の末尾>\n${previous.slice(-PREVIOUS_LIMIT)}\n</前の回答の末尾>`)
  }
  parts.push(`<依頼>\n${request.slice(0, REQUEST_LIMIT)}\n</依頼>`)
  return parts.join('\n\n')
}

// Haiku の返事から段階を読む。読めなければ undefined
export function readLevel(text: string): Level | undefined {
  const m = text.toLowerCase().match(/\b(low|medium|high|xhigh)\b/)
  return m ? (m[1] as Level) : undefined
}

// 1段上げる。xhigh より上には上げない(D-022)
export function raise(level: Level): Level {
  return LEVELS[Math.min(LEVELS.indexOf(level) + 1, LEVELS.length - 1)]
}
