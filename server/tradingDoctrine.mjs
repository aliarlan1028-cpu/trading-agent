// 《加密永续交易条令 v1》注入(用户 2026-08 审定)。把条令落成:
//  · 5 条「富透镜」→ db.knowledge.lenses(注入决策提示词,只塑造分析、不下单;含反瘫痪与信号强度→仓位)
//  · 8 条「行为纪律铁律」→ db.knowledge.ruleProposals(已批准,注入"必须无条件遵守"块;action=none 仅约束判断、不新增引擎硬闸)
// 反瘫痪核心:透镜不新增任何 go/no-go 闸;弱对齐→缩仓(不是不做);显式反瘫痪指令写进核心透镜。
// 场景透镜压成一条"场景手册"由 LLM 按当前 regime 自行匹配(只有一个 regime 成立),避免注入 10 条互相打架。
import { id, nowIso, appendAudit } from "./store.mjs";

const DOCTRINE_SOURCE = { id: "src_doctrine_v1", title: "加密永续交易条令 v1", type: "doctrine" };

const DOCTRINE_LENSES = [
  { key: "core", name: "条令·核心判读与反瘫痪", promptText:
    "分析永续按五视角排序:①持有成本(资金费率对该币历史P85的偏离+基差)②微观结构(盘口买卖失衡/点差bps/√参与率冲击成本/OI变化)③聪明钱(大户多空比+主动买卖比)④多周期(高周期定方向:位置+斜率+摆动结构三票;低周期找点位)⑤事件面。" +
    "【信号强度→仓位】五视角对齐越强仓越大、越弱仓越小——弱对齐不是不做的理由,是缩仓的理由。" +
    "【反瘫痪·重要】透镜与纪律是让你分析更专业,不是更不敢交易:2-3个视角同向+清晰结构(如放量破位/明确供需区反应)+盈亏比达标,你就应当也必须提计划(含做空);完美对齐是加分项、不是前置条件;不确定时用更小仓位+更严结构确认来控制风险,而不是一刀切观望、一次次错过机会。" },
  { key: "scenarios", name: "条令·行情场景手册(按当前regime套用,只有一个成立)", promptText:
    "S1趋势(多周期结构对齐):顺势回调进场,不逆势摸顶抄底,盈利用追踪止损让利润奔跑。" +
    "S2区间震荡:只做边缘均值回归(上沿找空/下沿找多,目标对边),不追中部、不追突破。" +
    "S3突破:需收盘确认+放量+盘口失衡同向+不立刻缩回才算真突破,不追盘中未收盘的突破。" +
    "S4高波动/异动:先分'信息驱动(有新闻)'vs'清算级联(无因暴动)',按ATR放宽止损同时等比缩仓(风险金额恒定)。" +
    "S5低流动性(点差>5bps/深夜/冷门币):只做高确定性、小仓、限价,冲击成本优先估。" +
    "S6资金费率极端(|费率|≥历史P85):极端正=多头拥挤易多杀多、极端负=空头拥挤易空杀空;结合盘口失衡+OI判'加速'还是'挤压前兆';大量同向仓+极端费率+OI骤变=可能连环强平,别站洪流前;不与拥挤同向追单加仓。" +
    "S7事件驱动(FOMC/CPI/上币/黑客/ETF):事件前降波动敞口,判是否已计价(pricedIn),未证实高影响社媒按线索不按事实。" +
    "S8大盘联动:先看BTC/大盘regime+聪明钱再看个币,山寨beta放大BTC波动,逆大盘做山寨要更严条件。" +
    "S9对冲/套利:识别现货-永续基差、永续-季度期限结构、跨所价差的套利/对冲机会,跨腿须两腿同步风控。" +
    "S10宏观&叙事:利率预期/DXY/risk-on-off是背景偏置(非直接信号,'降息预期利于风险资产'≠'降息就做多BTC');山寨区分脆弱急拉vs结构性推动;交易前留意代币解锁/大额释放抛压。" },
  { key: "lifecycle", name: "条令·持仓生命周期管理", promptText:
    "P1开仓前:核对五视角结论+盈亏比+强平距离+组合波动预算,想清'失效条件是什么'。" +
    "P2持仓中:开仓逻辑是否还成立(资金费率转强烈不利/反向高可信新闻/结构破坏),被证伪就按纪律减或平,绝不为亏损仓找支持性理由。" +
    "P3盈利中:TP1后移保本,趋势用追踪止损,震荡到对边止盈;连续盈利后不放大仓位超计划(赢钱后的自负比亏钱更危险)。" +
    "P4亏损中:区分'结构仍有效的正常回撤'vs'逻辑已破该止损',绝不下移止损扩大亏损、绝不无计划摊平加仓(扛单)。" +
    "P5连亏后:识别报复性交易/找回本金心态,强制降频降仓(连亏冷却/回撤锁仓已由引擎硬拦)。" +
    "P6平仓后:按'过程'复盘不按结果——进出对不对、纪律破没破、是运气还是方法;结果好但过程错的单也标记,亏损单必复盘。" },
  { key: "execution", name: "条令·执行与成本", promptText:
    "按紧迫度选执行:不急用限价/被动挂单省成本,急用市价但先估冲击;大单拆分,不一次扫穿盘口;限价单有逆向选择(只在你错时成交)。" +
    "【成本闸】预期'往返成本(点差+冲击+资金费率)'吃掉大部分预期收益就不做——edge须显著大于成本。" +
    "【波动率目标仓位】高波动币缩仓、低波动币可放大,让每笔交易贡献相近的风险/波动,而非固定名义。" +
    "【分散】不把风险集中在单一策略或单一币种。" },
  { key: "risk", name: "条令·风险与压力测试", promptText:
    "开仓前做情景压力测试:若BTC 1小时-15%,组合浮亏+各仓强平距离会怎样(用真实持仓+强平价+杠杆算,不拍脑袋)。" +
    "模型风险:不盲信某策略的历史回测,已验证策略也会衰减、绩效下滑要降权。" +
    "交易所/对手方:单交易所敞口占比过高要警示;高杠杆盈利单在极端行情可能被交易所ADL自动减仓。" +
    "操作/系统风险：数据陈旧、WS 断连或订单状态 UNKNOWN 时应暂停新开仓，不在盲区里扩大风险。" }
];

const DOCTRINE_RULES = [
  { category: "循证", name: "反叙事开仓:无统计支撑、说不出失效条件的形态式开仓禁止", condition: "凭K线'看起来合理'但无法证伪" },
  { category: "循证", name: "反过拟合:只认样本外+纯前向验证过的策略,不把模板名/知识方法冒充'已验证策略'" },
  { category: "心理", name: "投机≠赌博:入场前必须有预定的失效/离场点,没有预定退出的仓不开", condition: "无明确失效点" },
  { category: "风控", name: "亏损中绝不下移止损扩大亏损", condition: "持仓浮亏" },
  { category: "风控", name: "绝不无计划加仓摊平(扛单)", condition: "持仓浮亏想加仓" },
  { category: "心理", name: "连续盈利后仓位不随浮盈膨胀、不超计划上限", condition: "连胜后" },
  { category: "心理", name: "持仓逻辑被证伪时不找支持性信息硬扛,按纪律减/平", condition: "开仓论点已破" },
  { category: "执行", name: "复盘按过程打分不按结果:结果好但过程错的单也要标记、亏损单必复盘" }
];

const DOCTRINE_SEED_VERSION = 1;

export function ensureTradingDoctrine(db, actor = "TradingDoctrine") {
  db.knowledge ||= {};
  db.knowledge.lenses ||= [];
  db.knowledge.ruleProposals ||= [];
  db.knowledge.sources ||= [];
  db.meta ||= {};
  if (db.meta.doctrineSeedVersion === DOCTRINE_SEED_VERSION) return { created: 0, skipped: "already_seeded" };

  if (!db.knowledge.sources.some((s) => s.id === DOCTRINE_SOURCE.id)) {
    db.knowledge.sources.push({ ...DOCTRINE_SOURCE, status: "parsed", createdAt: nowIso() });
  }
  let lensN = 0;
  for (const l of DOCTRINE_LENSES) {
    if (db.knowledge.lenses.some((x) => x.doctrineKey === l.key)) continue;
    db.knowledge.lenses.push({
      id: id("lens"), name: l.name, promptText: l.promptText,
      doctrine: true, doctrineKey: l.key, active: true,
      sourceId: DOCTRINE_SOURCE.id, sourceTitle: DOCTRINE_SOURCE.title, createdAt: nowIso()
    });
    lensN += 1;
  }
  let ruleN = 0;
  for (const r of DOCTRINE_RULES) {
    if (db.knowledge.ruleProposals.some((x) => x.doctrine && x.name === r.name)) continue;
    db.knowledge.ruleProposals.push({
      id: id("rule"), name: r.name, category: r.category, condition: r.condition || "",
      action: "none", status: "已批准", doctrine: true,
      sourceRefs: [DOCTRINE_SOURCE.id], description: "《加密永续交易条令 v1》· 行为纪律(约束判断,不新增引擎硬闸)",
      createdAt: nowIso()
    });
    ruleN += 1;
  }
  db.meta.doctrineSeedVersion = DOCTRINE_SEED_VERSION;
  if (lensN || ruleN) appendAudit(db, `交易条令 v1 入列:透镜 ${lensN} 条 + 行为纪律 ${ruleN} 条`, DOCTRINE_SOURCE.id, actor);
  return { created: lensN + ruleN, lenses: lensN, rules: ruleN };
}
