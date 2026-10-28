export type CardRarity = 'N' | 'R' | 'SR' | 'SSR';
export interface CardDefinition { id: string; name: string; rarity: CardRarity; type: string; stat: string; summary: string; effect: string; detail: string; action: string }
export const CARD_CATALOG: CardDefinition[] = [
  {id:'n-acceleration',name:'加速',rarity:'N',type:'个人增益',stat:'+15%',summary:'让下一次认真，跑得更快一点。',effect:'下次有效签退获得该次有效时长 15% 的娱乐加成，最多 30 分钟。',detail:'作废打卡不触发、不消耗加速；同一时间只保留一个待生效效果。',action:'轻盈冲刺，运动披风与流动的时间光带。'},
  {id:'n-reduce',name:'减时长',rarity:'N',type:'随机扣时',stat:'−30 MIN',summary:'偷偷拨动指针，时间就溜走了。',effect:'随机选择一名同年级其他玩家，扣除 30 分钟娱乐时长。',detail:'允许扣成负数。不改变真实考勤记录。',action:'拨动倒转的时钟，俏皮地藏起一枚指针。'},
  {id:'n-gamble',name:'我赌你的枪里没有子弹',rarity:'N',type:'自身判定',stat:'50 / 50',summary:'这次，运气站在哪一边？',effect:'50% 概率自己扣除 30 分钟娱乐时长；50% 概率无事发生。',detail:'先判定再处理防御；未出现不利结果时不消耗防御卡。',action:'白青色马甲，抛起硬币，俏皮地接受运气挑战。'},
  {id:'n-shield',name:'仁王盾',rarity:'N',type:'被动防御',stat:'BLOCK · N',summary:'小小盾牌，也要认真守护。',effect:'自动抵挡一次 N 级卡牌造成的扣时或不利判定结果。',detail:'触发后消耗；不能抵挡 R、SR、SSR 卡牌。',action:'举起小圆盾，稳稳护住身前。'},
  {id:'r-add',name:'加时卡',rarity:'R',type:'指定增益',stat:'+30 MIN',summary:'把多一点时间，送给你。',effect:'给自己或指定一名同年级玩家增加 30 分钟娱乐时长。',detail:'可对自己或他人使用；与考核、排行共用综合时长，每满 1 分钟对应 1 抽卡积分额度。',action:'双手送出发光的沙漏，温柔微笑。'},
  {id:'r-steal',name:'顺手牵羊',rarity:'R',type:'随机偷取',stat:'STEAL 30',summary:'这三十分钟，我就收下啦。',effect:'随机一名同年级其他玩家娱乐时长 −30 分钟，自己 +30 分钟。',detail:'目标即使为零或负数也能被偷取；转移同时改变双方的综合时长与抽卡积分额度。',action:'小盗贼斗篷，伸手勾走一枚沙漏。'},
  {id:'r-mystery',name:'?',rarity:'R',type:'随机换卡',stat:'MYSTERY',summary:'下一张，会是什么呢？',effect:'按基础概率获得另一张卡，不能获得 ? 自身。',detail:'不累计、不触发普通抽卡保底；不消耗普通抽卡机会。',action:'打开神秘信封，发现其中发光的未知卡片。'},
  {id:'r-blade',name:'名刀司命',rarity:'R',type:'被动防御',stat:'BLOCK · N–R',summary:'在坏运气落下前，轻轻截住。',effect:'自动抵挡一次 N～R 级对自己不利的卡牌效果或判定结果。',detail:'触发后消耗；有益效果不触发；不能抵挡 SR 红桃 K。',action:'轻巧剑士服，横刀截住飞来的光刃。'},
  {id:'r-charity',name:'慈善家',rarity:'R',type:'同年级赠送',stat:'SHARE 10%',summary:'把拥有的一点光，分给大家。',effect:'将自己正娱乐余额的 10% 平均转移给其他同年级玩家。',detail:'自己同步扣除；无正余额或无人接收时不能使用。',action:'张开双手，分出数枚小星形时间礼物。'},
  {id:'r-skip',name:'乐不思蜀',rarity:'R',type:'限时禁用',stat:'PAUSE 1H',summary:'先坐下来，喝一杯再说。',effect:'指定一名同年级其他玩家，1 小时不能主动使用卡牌。',detail:'不影响打卡、抽卡或已有被动防御。',action:'柔软睡衣装扮，悠闲地坐在云朵摇椅上。'},
  {id:'r-thief',name:'神偷奶爸',rarity:'R',type:'转移赠送',stat:'GIFT ≤30',summary:'拿来的时间，是给你的礼物。',effect:'从随机同年级其他玩家处转移最多 30 分钟正娱乐余额，送给指定的非自己玩家。',detail:'供给方与接收方不能相同，只转移实际正余额；双方抽卡积分额度随实际综合时长同步变化。',action:'背着小礼物包，一手接沙漏、一手递礼物。'},
  {id:'sr-angel',name:'天使卡',rarity:'SR',type:'同年级增益',stat:'ALL +30',summary:'今天的好运，每个人都有份。',effect:'同年级正式玩家，包括使用者，各获得 30 分钟娱乐加成。',detail:'按每个接收者分别结算；无懈可击的免疫范围包含他人增益。',action:'小天使礼服与光翼，双手洒落温柔星光。'},
  {id:'sr-chain',name:'铁索连环',rarity:'SR',type:'关联状态',stat:'LINK ×2',summary:'这一刻，你与我的时间相连。',effect:'绑定两名不同的同年级玩家，下一次一方娱乐时长变化同步给另一方，随后解除。',detail:'同步不能再次触发连环；积分额度随综合时长同步变化，同步效果按 SR 级处理防御。',action:'挥舞两条紫色星链，将两枚沙漏连在一起。'},
  {id:'sr-lightning',name:'雷电',rarity:'SR',type:'顺序判定',stat:'50% · −60',summary:'沿着名单，等待第一道闪电。',effect:'同年级其他玩家按用户名升序，逐人独立进行 50% 判定，首个命中者扣除 60 分钟娱乐时长。',detail:'首个命中即结束，即使被防御或反弹也不继续；全部未命中则无效果。',action:'雷法师披风，举起短杖唤下一道闪电。'},
  {id:'sr-reflect',name:'反弹',rarity:'SR',type:'被动反击',stat:'RETURN ×1',summary:'这份坏心思，原路奉还。',effect:'将一次针对个人的负面效果反弹给原使用者。',detail:'触发后消耗；不反弹群体效果；反弹不能再次反弹，可应对红桃 K。',action:'撑起棱镜护镜，将光箭折返。'},
  {id:'sr-famine',name:'兵粮寸断',rarity:'SR',type:'获取限制',stat:'LOCK 3H',summary:'补给暂停，先用好手里的牌。',effect:'指定一名同年级其他玩家，3 小时不能获得新卡。',detail:'禁止普通抽卡与 ? 获卡；可积累积分、抽卡机会并使用已有卡牌。',action:'军师披肩，用符锁封住卡牌补给箱。'},
  {id:'sr-invasion',name:'南蛮入侵',rarity:'SR',type:'群体攻击',stat:'N / −15',summary:'小小远征，带走一点好运。',effect:'同年级其他玩家各随机失去一张 N 卡；没有 N 卡则扣除 15 分钟娱乐时长。',detail:'按玩家分别处理免疫；扣时允许负数。',action:'小将军装扮，击响战鼓，发起一场可爱的远征。'},
  {id:'sr-redking',name:'红桃 K',rarity:'SR',type:'指定穿透',stat:'−30 · PIERCE',summary:'这一张，只能原路奉还。',effect:'指定一名同年级其他玩家，扣除 30 分钟娱乐时长，允许负数。',detail:'特殊规则：只能被反弹应对，穿透仁王盾、名刀司命及无懈可击。',action:'红黑王室礼服，亮出红桃王牌，果断指向前方。'},
  {id:'ssr-harvest',name:'五谷丰登',rarity:'SSR',type:'同年级赠卡',stat:'ALL +2 DRAWS',summary:'丰收的喜悦，要一起分享。',effect:'同年级正式玩家，包括使用者，各获得 2 次额外抽卡机会。',detail:'每次使用均可生效，没有每周受益上限；赠送机会当周有效，参与普通保底。',action:'丰收祭司礼服，捧起金色麦穗与两枚卡牌光印。'},
  {id:'ssr-invincible',name:'无懈可击',rarity:'SSR',type:'限时免疫',stat:'WARD 24H',summary:'此刻，光芒为你筑起结界。',effect:'保护自己 24 小时，免疫其他玩家施加的有益及有害卡牌效果。',detail:'不免疫自身效果，时长不叠加；红桃 K 按穿透特例处理。周一状态重置可提前结束保护。',action:'华丽白金守护服，悬浮冥想，金色星环结界环绕。'},
  {id:'ssr-arrows',name:'万箭穿心',rarity:'SSR',type:'群体与指定攻击',stat:'10% + STRIKE',summary:'万千星芒，汇于决定的一击。',effect:'其他同年级玩家各扣正娱乐余额 10%，每人最多 15 分钟；指定一人额外扣除实际损失总额的一半，最多 60 分钟。',detail:'比例阶段仅计算正余额；额外扣除允许负数。',action:'白金弓手礼服，拉开星弓，万千金色光箭汇聚。'}
];
