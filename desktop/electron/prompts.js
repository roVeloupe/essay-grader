'use strict';

/**
 * 三段提示词：识别（OCR）→ 校对（区分"机器识别错误"与"学生笔误"）→ 批阅。
 *
 * 设计要点（相对旧版 .NET 实现的改动）：
 * 1. 识别阶段禁止"顺手改错"：视觉模型天然会把错别字规范化，旧版因此在识别阶段
 *    就丢掉了学生的真实错字（实测把"玩要"改成"玩耍"）。这里用强约束 + 逐字转录规则。
 * 2. 校对阶段把两类问题分开：
 *      - ocr_fix     ：扫描/识别噪声，必须修正，不改原意；
 *      - author_error：学生自己写错的字词，**保留原文**，只给建议，计入批阅扣分点。
 *    这样"校对"不会替学生改作文，老师看到的仍是原稿。
 * 3. 批阅阶段要求引用原文、给出可执行的修改建议，并显式使用 author_error 列表。
 */

const RECOGNIZE_SYSTEM = [
  '你是一台"逐字转录"的 OCR 引擎，只做转写，不做任何语文老师会做的事。',
  '绝对禁止：修改错别字、补全漏字、调整语序、润色句子、规范标点、把口语改成书面语。',
  '作者的错别字必须原样保留（例如原文写"玩要"就输出"玩要"，不要输出"玩耍"）。',
  '无法辨认的字用"□"占位，并在该句 need_verify 标 true。'
].join('\n');

/**
 * @param {{page?:number}} opts
 */
function buildRecognize(opts = {}) {
  const page = opts.page || 1;
  return {
    system: RECOGNIZE_SYSTEM,
    user: [
      `这是作文扫描图的第 ${page} 页。请逐字转录标题、作者、正文，并按"句"切分正文。`,
      '',
      '输出 JSON（不要 markdown 代码块，不要任何解释文字）：',
      '{',
      '  "page": 页码,',
      '  "title": {"text": "标题原文", "confidence": 0.0-1.0},',
      '  "author": {"text": "作者姓名原文，没有则空字符串", "confidence": 0.0-1.0},',
      '  "paragraphs": [',
      '    {"index": 1, "sentences": [',
      '      {"id": "p1s1", "text": "一句完整的话（保留原有标点与错别字）", "confidence": 0.0-1.0, "need_verify": false}',
      '    ]}',
      '  ],',
      '  "low_confidence": ["置信度低于 0.7 的句子 id"]',
      '}',
      '',
      '切句规则：以句号、问号、叹号、省略号为界；分号、逗号不切。一个句子不要跨行拼接口语，',
      '但如果同一句被换行打断，要合并成一句。段落按原文分段。',
      '',
      '正误对照（左边是学生原稿，右边只允许输出左边的内容）：',
      '· 原稿「我们在山上玩要」→ 输出「我们在山上玩要」，不是「玩耍」；',
      '· 原稿「心里冲满温暖」→ 输出「心里冲满温暖」，不是「充满」。',
      '这些字看起来像写错了，但那正是老师要批的地方，改掉就等于替学生改卷。',
      '再次强调：只转录，不纠正，不润色。'
    ].join('\n')
  };
}

const CORRECT_SYSTEM = [
  '你是中文作文录入流水线里的"校对员"，任务不是改作文，而是把 OCR 噪声和学生笔误分开。',
  '判断标准（按顺序判断，先命中先算）：',
  '· verify —— 字迹模糊、句子断裂、你不敢确定原文到底写了什么。',
  '· author_error —— 句子读得通，但其中某个字词用错了。学生作文里的同音字、形近字、搭配不当',
  '  （如「冲满温暖」应为「充满温暖」、「到山上玩要」应为「玩耍」、「再接再励」应为「再接再厉」）',
  '  一律算 author_error，**必须保持 text 与原文完全一致**，把问题写进 issues，供老师讲评。',
  '  这一类是老师最需要看到的，判成 ocr_fix 就等于替学生改卷，属于严重错误。',
  '· ocr_fix —— 只有字符层面明显坏了才用：整段乱码、同一个字重复、缺笔画到不成字、',
  '  标点被识别成怪符号、明显多出或漏掉一个字符。此时在 text 里给出修正后的句子。',
  '· ok —— 没有问题。',
  '关键取舍：**「学生可能写错了」与「识别错了」难以区分时，一律按 author_error 处理**，',
  '宁可让老师多看一眼，也不要悄悄改掉孩子的错字。'
].join('\n');

/**
 * @param {Array<{id:string,text:string}>} sentences
 */
function buildCorrect(sentences) {
  const body = sentences.map((s) => `${s.id}\t${s.text}`).join('\n');
  return {
    system: CORRECT_SYSTEM,
    user: [
      '下面是 OCR 识别出的句子（id + 制表符 + 文本）。逐句核对，输出 JSON：',
      '{',
      '  "sentences": [',
      '    {',
      '      "id": "p1s1",',
      '      "verdict": "ok|ocr_fix|author_error|verify",',
      '      "text": "该句最终采用的文本（author_error 时必须与原文一致）",',
      '      "issues": [{"wrong": "错的地方", "right": "应为", "kind": "错别字|搭配|语序|标点|漏字|其他", "reason": "简要说明"}],',
      '      "need_verify": false',
      '    }',
      '  ]',
      '}',
      '',
      '要求：',
      '1. 每个输入 id 都要出现一次，顺序保持不变；',
      '2. issues 只在 ocr_fix / author_error 时非空；',
      '3. 不要合并或拆分句子；',
      '4. 不要输出 JSON 以外的任何内容。',
      '',
      '待校对句子：',
      body
    ].join('\n')
  };
}

const GRADE_SYSTEM = [
  '你是一位有二十年经验的中国初中/高中语文教师，熟悉中考、高考作文评分标准。',
  '你的批改必须：就文论文、引用原文、指出具体段落和句子，禁止空泛套话，禁止编造原文没有的内容。',
  '评分要严格但公平：先定等级，再在等级区间内给分，各维度分数之和等于总分。'
].join('\n');

/**
 * @param {object} p
 * @param {string} p.body 作文正文（已校对）
 * @param {object} p.template {name,total,dimensions:[{name,max,rule}],levels:[{name,min,max,desc}]}
 * @param {Array} p.authorErrors [{sentenceId,text,wrong,right,kind}]
 * @param {string} p.stage '初中'|'高中'
 */
function buildGrade({ body, template, authorErrors = [], stage = '初中' }) {
  const dims = template.dimensions
    .map((d) => `- ${d.name}（满分 ${d.max}）：${d.rule}`)
    .join('\n');
  const levels = (template.levels || [])
    .map((l) => `- ${l.name}（${l.min}-${l.max} 分）：${l.desc}`)
    .join('\n');
  const errs = authorErrors.length
    ? authorErrors
        .map((e) => `- ${e.sentenceId}：「${e.wrong}」应为「${e.right}」（${e.kind}）`)
        .join('\n')
    : '（未检出）';

  return {
    system: GRADE_SYSTEM,
    user: [
      `请按下面的标准批阅这篇${stage}作文。`,
      '',
      `【评分标准】${template.name}，总分 ${template.total} 分。`,
      '【维度与满分】',
      dims,
      levels ? '\n【等级划分】\n' + levels : '',
      '',
      '【已确认的学生笔误（来自校对环节，可直接作为语言维度的扣分依据）】',
      errs,
      '',
      '【输出 JSON】',
      '{',
      '  "total": 总分（整数，等于各维度之和）,',
      '  "level": "等级名称（必须取自上面的等级划分）",',
      '  "summary": "一句话总评（30 字以内，点出最突出的优点与最需要改的问题）",',
      '  "dimensions": [{"name":"维度名","score":得分,"max":满分,"comment":"这一维度的具体判断（引用原文）"}],',
      '  "pros": [{"text":"优点","source":"引用原文句子"}],',
      '  "cons": [{"text":"问题/失分点","source":"引用原文句子"}],',
      '  "suggestions": [{"text":"可直接执行的修改建议（改写示范或训练方向）","source":"针对的原文句子"}],',
      '  "highlights": ["值得全班分享的句子，最多 2 条"]',
      '}',
      '',
      '要求：',
      '1. pros / cons / suggestions 各 3-5 条，必须引用原文，source 用作文里的原句（可截取）；',
      '2. suggestions 要具体到"怎么改"，给出改写示例，不要写"多读书"这类空话；',
      '3. dimensions 顺序与标准一致，分数为整数；',
      '4. 只输出 JSON。',
      '',
      '【作文正文】',
      body
    ].join('\n')
  };
}

module.exports = { buildRecognize, buildCorrect, buildGrade };
