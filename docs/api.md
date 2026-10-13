# مرجع کامل API — قالب فایل ارائه و بانک سؤال

این سند **مرجع کامل و بدون حذف** است: هر میدان، هر مقدار مجاز، هر رفتار
پیش‌فرض و هر خطایی که هنگام ورود ممکن است رخ دهد. برای یادگیری سریع‌تر و
نسخهٔ «چطور بنویسم» به [`authoring.md`](authoring.md) نگاه کنید؛ این فایل
مرجع قطعی است.

مرجع پیاده‌سازی: `src/types.ts` (مدل دامنه)، `src/storage.ts` (مهاجرت و
اعتبارسنجی)، `src/lib/store.ts` (API برنامه‌نویسی)، `src/lib/anim/expr.ts`
(زبان فرمول)، `src/components/blocks/RichText.tsx` (نشانه‌گذاری متن).

---

## فهرست

1. [خط لولهٔ داده](#۱-خط-لولهٔ-داده)
2. [قرارداد ورود (Import)](#۲-قرارداد-ورود)
3. [جدول اعتبارسنجی میدان‌به‌میدان](#۳-جدول-اعتبارسنجی-میدانبه‌میدان)
4. [`Presentation`](#۴-presentation)
5. [`Slide`](#۵-slide)
6. [`SlideStep` — union کادرها](#۶-slidestep--union-کادرها)
7. [`Animation`](#۷-animation)
8. [`AnimScene`](#۸-animscene)
9. [`AnimSeries`](#۹-animseries)
10. [`AnimLayer` و `AnimKey`](#۱۰-animlayer-و-animkey)
11. [`QuestionBank` و `BankQuestion`](#۱۱-questionbank-و-bankquestion)
12. [枚举 — همهٔ مقادیر مجاز](#۱۲-فهرست-کامل-مقادیر-مجاز)
13. [زبان فرمول `expr`](#۱۳-زبان-فرمول-expr)
14. [نشانه‌گذاری متن درون‌خطی](#۱۴-نشانهگذاری-متن-درونخطی)
15. [کلیدهای ذخیره‌سازی](#۱۵-کلیدهای-ذخیرهسازی)
16. [API برنامه‌نویسی (`storage.ts` / `store.ts`)](#۱۶-api-برنامهنویسی)
17. [مسیرها (Routes)](#۱۷-مسیرها)
18. [خطاها](#۱۸-خطاها)
19. [نسخه‌بندی و مهاجرت](#۱۹-نسخهبندی-و-مهاجرت)
20. [حدود و نکات](#۲۰-حدود-ونکات)

---

## ۱. خط لولهٔ داده

```
فایل .json  →  JSON.parse  →  migrateStep/migrateSlide/migratePresentation
            →  map بر اساس id  →  localStorage  →  رندر
```

* `migrate*` تنها جایی است که دادهٔ نامعتبر **نرمال‌سازی** می‌شود. اگر
  میدانی را اینجا بنویسید، بقیهٔ برنامه آن را معتبر فرض می‌کند.
* میدان ناشناخته **حذف نمی‌شود** در `migrateStep` برای انواع ساده، ولی
  `migratePresentation` خروجی را با کلیدهای ثابت می‌سازد؛ پس فیلد اضافه در
  سطح ارائه/بخش از بین می‌رود. در `anim` به‌صورت `...(a as Partial<Animation>)`
  پخش می‌شود، یعنی میدان‌های اضافهٔ انیمیشن **حفظ** می‌شوند.
* هیچ اعتبارسنجی اسکیمایی (JSON Schema) وجود ندارد؛ همه چیز دستی است.

---

## ۲. قرارداد ورود

```ts
ingestPresentations(input: unknown): Presentation[]
```

| ورودی | نتیجه |
| --- | --- |
| `Presentation` (شیء) | همان یک ارائه |
| `Presentation[]` (آرایه) | همهٔ ارائه‌ها |
| `{ slides: [] }` یا `slides` غیرآرایه | **خطا**: `فایل JSON معتبر نیست` |
| هر چیز دیگر | **خطا**: `فایل JSON معتبر نیست` |

رفتار ادغام:

```ts
const byId = new Map(existing.map(p => [p.id, p]))
for (const p of incoming) byId.set(p.id, { ...p, updatedAt: Date.now() })
```

* `id` یکسان ⇒ **بازنویسی کامل** ارائهٔ موجود (ادغام عمیق نیست).
* `id` جدید ⇒ افزوده به انتهای کتابخانه.
* خروجی: کل کتابخانه پس از تغییر.
* `updatedAt` ورودی‌ها همیشه با `Date.now()` بازنویسی می‌شود.

---

## ۳. جدول اعتبارسنجی میدان‌به‌میدان

### سطح ارائه

| میدان | اگر نباشد | اگر نوعش غلط باشد | اگر مقدارش خارج از محدوده باشد |
| --- | --- | --- | --- |
| `schema` | `2` | — | هر عددی پذیرفته و **بازنویسی به ۲** |
| `id` | `uid('pres')` | `uid('pres')` | رشتهٔ خالی ⇒ `uid('pres')` |
| `title` | `'بدون عنوان'` | `'بدون عنوان'` | رشتهٔ خالی ⇒ `'بدون عنوان'` |
| `description` | `''` | `''` | — |
| `theme` | `'light'` | `'light'` | غیر از سه مقدار ⇒ `'light'` |
| `layout` | `'flow'` | `'flow'` | غیر از `'stack'` ⇒ `'flow'` |
| `slides` | **رد شدن کل ارائه** | **رد شدن کل ارائه** | آرایهٔ خالی ⇒ **رد شدن** |
| `createdAt` | `Date.now()` | `Date.now()` | عدد غیرمتناهی ⇒ `Date.now()` |
| `updatedAt` | `Date.now()` | `Date.now()` | — |

> «رد شدن» یعنی `migratePresentation` مقدار `null` برمی‌گرداند و آن ارائه
> اصلاً وارد نمی‌شود. اگر هیچ‌کدام از ورودی‌ها معتبر نباشند، کل عملیات خطا
> می‌دهد.

### سطح بخش

| میدان | اگر نباشد | نکته |
| --- | --- | --- |
| `id` | `` `slide-${index}` `` | برخلاف بقیه، **قطعی** است — دو بخش بدون `id` در یک فایل، شناسهٔ یکسان می‌گیرند و در عمل می‌شکنند. |
| `title` | `` `بخش ${index + 1}` `` | — |
| `steps` | `[]` | غیرآرایه ⇒ `[]`؛ هر عضو نامعتبر بی‌صدا حذف می‌شود |
| `notes` | `''` | متن ساده؛ در اجرا با کلید `N` |

### سطح گام (`migrateStep`)

| میدان | رفتار |
| --- | --- |
| `kind` | اگر در `KIND_LABEL` نباشد ⇒ **`'text'`** و محتوا در `value` حفظ می‌شود: `` `[${declared}] ${...}` `` |
| `id` | `uid('step')` |
| `span` | اگر `'full' \| 'half' \| 'third'` نباشد ⇒ `defaultSpanFor(kind)` |
| `value` | رشتهٔ خالی؛ اگر نباشد و `kind` اعلام‌شده باشد، برچسب + JSON خام در `value` می‌رود |

پیش‌فرض `span` به تفکیک `kind`:

| `kind` | `span` پیش‌فرض |
| --- | --- |
| `text`, `quiz`, `animation` | `full` |
| `list`, `formula`, `trap`, `image`, `video`, `code` | `half` |
| `callout` | `third` |

### سطح انیمیشن (مهم)

```ts
const base = emptyAnimation()
const anim = { ...base, ...(a as Partial<Animation>), scene: { ...base.scene, ...(a.scene ?? {}) },
  layers: Array.isArray(a.layers) ? a.layers : base.layers,
  series: Array.isArray(a.series) ? a.series : base.series }
```

یعنی:

* میدان‌های سطح `anim` پیش‌فرض دارند.
* `scene` **تک‌تک میدان‌ها** پیش‌فرض می‌گیرند (ادغام شیء‌ای).
* **`layers` و `series` هیچ پیش‌فرض یا اعتبارسنجی نمی‌گیرند.** هر عضو
  عیناً وارد می‌شود. یعنی `expr`، `tracks`، `color`، `shape` و … را
  **خودتان کامل بنویسید**؛ مقدار جاافتاده در runtime به `undefined`
  تبدیل می‌شود و می‌تواند رندر را بشکند یا آن را بی‌صدا خالی کند.
* `segments` و `annotations` اختیاری‌اند و پیش‌فرض `undefined` می‌مانند؛
  رندر با `(anim.segments ?? [])` کار می‌کند.

### پاره‌خط، آکولاد و پنجرهٔ زمانی

سه چیز که پیش از این فقط با کی‌فریم دستی ممکن بود:

```ts
anim.segments = [{ id, fromLayer, toLayer?, toPoint?, color, width?, dashed?,
                   showSlope?, ...windowFields }]
anim.annotations = [{ id, kind: 'brace' | 'span' | 'text',
                      from: { layer?, point? }, to: { layer?, point? },
                      orientation: 'horizontal' | 'vertical' | 'auto',
                      label, color?, side?: 1 | -1, ...windowFields }]
```

`windowFields` روی **لایه، منحنی، پاره‌خط و نشانه** یکسان است:

| میدان | معنی |
| --- | --- |
| `visibleFrom` / `visibleTo` | بازهٔ ثانیه‌ای دیده‌شدن (پیش‌فرض: تا `duration`) |
| `fadeIn` / `fadeOut` | طول محو ورود/خروج |

یعنی یک صحنه خودش زمان‌بندی می‌شود: آکولاد در ۱٫۵ ثانیه می‌آید و در
۳ ثانیه می‌رود، بدون آنکه کی‌فریم دستی برای شفافیت بنویسید.

سرِ پاره‌خط و آکولاد یا `layer` است (به جسم می‌چسبد و حرکت می‌کند) یا
`point` (نقطهٔ ثابت در واحدهای صحنه).

### متغیرهای محلی فرمول

لایه‌های `mode: 'expr'` می‌توانند `exprParams` داشته باشند — دیکشنری از
نام به فرمولِ برحسب `t`. نام‌ها فقط داخل `exprX`/`exprY` همان لایه معتبرند:

```json
{ "mode": "expr", "exprParams": { "dt": "max(0, 2.2 - (2.2/3.5)*max(0, t - 3.5))" },
  "exprX": "2 + dt", "exprY": "0.5*(2+dt)^2 - 2*(2+dt) + 4" }
```

بدون این، کوچک‌کردن فاصلهٔ دو نقطه یعنی کی‌فریم‌های دستی روی هر ۲۴
FRAME/DURATION.

### دو دام رایج

* **جسمِ لنگر را `follow` نکنید.** `mode: 'follow'` جسم را روی
  *بدنهٔ چرخان* می‌برد، نه روی یک لحظهٔ ثابت؛ برای نقطهٔ `t₀ = 2` از
  `expr` با عدد ثابت استفاده کنید.
* **`tangent` روی بدنهٔ چرخان کشیده می‌شود.** اگر می‌خواهید مماس در یک
  لحظهٔ معین باشد، جسم لنگر را ثابت کنید.

---

## ۴. `Presentation`

```ts
type Presentation = {
  schema: number                  // 2
  id: string
  title: string
  description?: string
  theme?: 'light' | 'dark' | 'paper'
  layout?: 'flow' | 'stack'
  slides: Slide[]
  createdAt: number               // epoch ms
  updatedAt: number               // epoch ms
}
```

```json
{
  "schema": 2,
  "id": "ai-topic-1404",
  "title": "عنوان ارائه",
  "description": "یک خط توضیح",
  "theme": "light",
  "layout": "flow",
  "createdAt": 1750000000000,
  "updatedAt": 1750000000000,
  "slides": []
}
```

| `theme` | ظاهر |
| --- | --- |
| `light` | پس‌زمینهٔ روشن، کارت‌های سفید (پیش‌فرض) |
| `paper` | کاغذی گرم — برای جزوه و چاپ |
| `dark` | تیره |

| `layout` | رفتار `span` |
| --- | --- |
| `flow` | شبکهٔ ۶ ستونی؛ `full`=۶، `half`=۳، `third`=۲ |
| `stack` | همه چیز `col-span-6`؛ `span` نادیده گرفته می‌شود |

در حالت موبایل `third` به ۳ ستون می‌افتد (نصف عرض) — چیدمان عمداً عوض
می‌شود.

---

## ۵. `Slide`

```ts
type Slide = {
  id: string
  title: string
  steps: SlideStep[]
  notes?: string
}
```

```json
{
  "id": "s-signs",
  "title": "علامت کمیت‌ها",
  "notes": "قبل از شروع بپرس: «مکان مثبت یعنی سمت راست؟»",
  "steps": []
}
```

* `title` در اجرا بالای صفحه و در نمای کل (`G`) نمایش داده می‌شود.
* `notes` یادداشت معلم است: در اجرا پشت کلید `N`، در ویرایشگر در سربرگ
  بخش، و **در چاپ حذف می‌شود**.
* ترتیب `steps` = ترتیب نمایش. ترتیب بخش‌ها = ترتیب `slides`.

---

## ۶. `SlideStep` — union کادرها

```ts
type StepBase = { id: string; span: BlockSpan }   // BlockSpan = 'full' | 'half' | 'third'
```

هر عضو این union است و `kind` آن را تشخیص می‌دهد:

| `kind` | میدان‌های اضافه | نوع | پیش‌فرض |
| --- | --- | --- | --- |
| `text` | `value: string` | متن با نشانه‌گذاری درون‌خطی | `''` |
| `list` | `items: string[]`, `ordered?: boolean` | فهرست | `[]` / `false` |
| `formula` | `value: string` | LaTeX تمام‌عرض | `''` |
| `callout` | `value: string`, `tone: CalloutTone` | کادر رنگی | `tone: 'info'` |
| `trap` | `value: string` | «دام رایج» | `''` |
| `image` | `value: string`, `alt?: string`, `caption?: string` | `<img src>` | `''` |
| `video` | `value: string`, `caption?: string` | iframe یا `<video>` | `''` |
| `code` | `value: string`, `caption?: string` | `<pre>` با دکمهٔ کپی | `''` |
| `quiz` | `question: string`, `options: string[]`, `answerIndex: number`, `explanation?: string`, `bankId?: string` | سنجش | `''`، `[]`، `0` |
| `animation` | `anim: Animation` | صحنهٔ زنده | `emptyAnimation()` |

### اعتبارسنجی ریز

* `list.items` — هر عضو غیررشته‌ای **حذف** می‌شود. `ordered` فقط `true`
  دقیقاً پذیرفته می‌شود (`=== true`).
* `callout.tone` — یکی از `info`/`tip`/`warn`/`idea`، وگرنه `info`.
* `quiz.options` — هر عضو غیررشته‌ای حذف می‌شود؛ **محدودیت طول ندارد**،
  ولی رابط کاربری تا ۸ گزینه اضافه می‌کند و کلیدهای پاسخ تا ۱۲ گزینه
  (`1`–`6`، `a`–`f`) کار می‌کنند. توصیه: ۴ گزینه.
* `quiz.answerIndex` — **صفرپایه** و **کلمپ نمی‌شود**. اگر
  `answerIndex >= options.length` باشد، هیچ گزینه‌ای درست نیست و بازخورد
  همیشه «اشکال ندارد» می‌دهد. (در بانک سؤال، برخلاف، کلمپ می‌شود.)
* `quiz.bankId` — اگر به سؤالی در بانک اشاره کند، کارت به آن پیوند
  می‌خورد؛ اگر سؤال نبود، فقط متن `quiz` نمایش داده می‌شود.
* `image` — آدرس `http(s)` یا `data:`. شکست در بارگذاری ⇒ کادر «تصویر بارگذاری
  نشد» و قابل کلیک برای بزرگ‌نمایی.
* `video` — تشخیص خودکار: یوتیوب (`watch?v=`، `shorts/`, `embed/`,
  `youtu.be/`)، آپارات (`aparat.com/v/<hash>`)، Vimeo، یا پسوند
  `mp4|webm|ogg|mov`. هیچ‌کدام ⇒ به‌صورت لینک متنی نمایش داده می‌شود.
* `code` — `value` به سطرها شکسته و شماره‌گذاری می‌شود؛ حداکثر ارتفاع
  قابل اسکرول.
* `formula` — `BlockMath`؛ **بین `$` ننویسید**. فرمول خراب به‌جای خطا
  قرمز رنگ می‌شود و صفحه نمی‌شکند.
* `text` — `**پررنگ**`، `*مورب*`، `` `کد` ``، `==هایلایت==`،
  `$فرمول درون‌خطی$`، URL خام. خط جدید ⇒ `<br>`.

---

## ۷. `Animation2` — سند انیمیشن

نسخهٔ ۲. تشخیص با `schema: 2`. یک سند v1 همیشه هنگام بارگذاری ارتقا می‌یابد
(`migrateAnimationV1toV2`)، پس می‌توانید بدون شرط فراخوانی‌اش کنید.

```ts
type Animation2 = {
  schema: 2
  title: string
  duration: number          // ثانیه، بازهٔ مجاز 0.2 تا 600
  loop?: boolean
  autoplay?: boolean
  speed?: number
  /** مقادیر زنده؛ با نامشان در هر فرمولی در دسترس‌اند */
  params: Record<string, Param>
  cues: Cue[]
  /** گره‌های سطح بالا، در واحدهای بوم صحنه */
  nodes: Node[]
  templates?: Record<string, Template>
  readout?: boolean
  scene?: Scene2
}

type Param = {
  value: number
  min?: number
  max?: number
  step?: number
  label?: string
  /** در حالت نمایش، لغزندهٔ زنده نشان داده می‌شود */
  slider?: boolean
}

type Cue = {
  t: number
  label: string
  /** در حالت ارائه، پخش اینجا متوقف می‌شود و Space ادامه می‌دهد */
  pause?: boolean
}

type Scene2 = {
  width?: number
  height?: number
  aspect?: number            // اگر height نباشد از این ساخته می‌شود
  background?: string
  free?: boolean
}
```

## ۸. `Node` — تنها چیزی که رسم می‌شود

هیچ میدانی به نام سرعت، شتاب، مماس یا قاطع وجود ندارد. همهٔ آن‌ها درخت‌های
ساده‌ای از گره‌های زیر هستند.

```ts
type NodeBase = {
  id: string
  name?: string
  visible?: boolean          // پیش‌فرض true
  locked?: boolean           // در استودیو قابل انتخاب نیست
  time?: { start?: number; end?: number }
  transform: Transform
  motionPath?: MotionPath
  style?: NodeStyle
  description?: string
}

type Transform = {
  x: NumProp; y: NumProp
  scaleX: NumProp; scaleY: NumProp
  rotation: NumProp; opacity: NumProp
}

type NodeStyle = {
  fill?: ColorProp
  stroke?: ColorProp
  strokeWidth?: NumProp
  dash?: NumProp                       // طول الگو؛ 0 یعنی یکپارچه
  trim?: NumProp                       // 0..1 — «چقدر از خط کشیده شده»
}

type MotionPath = {
  points: Point2[]                     // [number, number][]
  closed?: boolean
  smooth?: boolean                      // Catmull-Rom مرکزگرا
  /** پیش‌فرض lt/duration؛ برحسب طول کمان اندازه‌گیری می‌شود */
  progress?: NumProp
}
```

### ۸.۱ — `NumProp`: سه حالت

```ts
type NumProp = number | { expr: string } | { keys: Key[] }

type Key = {
  id: string        // یکتا در کل انیمیشن، نه در یک ترک
  t: number
  v: number
  ease?: 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'hold' | 'smooth'
       | `cubic-bezier(${number},${number},${number},${number})`
}

type ColorProp = string | { keys: { id: string; t: number; v: string }[] }
type TextProp =
  | string
  | { keys: { id: string; t: number; v: string }[] }
  | { expr: string; format?: string }
  | { interp: string }        // "v = {round(x + a*t, 2)} m/s"
```

رنگ‌ها در حالت کلیدی **نگه داشته** می‌شوند، نه درون‌یابی. محو‌بینی دو رنگ
یعنی دو گره روی هم.

### ۸.۲ — انواع گره

```ts
type Node =
  | { id; type: 'rect';    w?; h?; rx? }            // NumProp
  | { id; type: 'ellipse'; rx?; ry? }
  | { id; type: 'line';    length?; arrowHead?: { start?; end?; size? } }
  | { id; type: 'path';    points?: Point2[]; parametric?: { xExpr; yExpr }; closed? }
  | { id; type: 'text';    text: TextProp; fontSize?; anchor?; latex? }
  | { id; type: 'image';   href: string; w?; h? }
  | { id; type: 'plot';    expr?; parametric?; domain?: [number, number];
                            samples?; draw?: 'line'|'dashed'|'dots'|'fill' }
  | { id; type: 'group';   children: Node[] }
  | { id; type: 'axes';    axes: AxesSpec; children: Node[] }
  | { id; type: 'use';     template: string; props?: Record<string, NumProp> }
```

> `draw` نه `style` نام‌گذاری شده، چون `style` در هر گره به رنگ و ضخامت خط
> اشاره دارد و این یکی دربارهٔ خودِ منحنی است.

### ۸.۳ — `axes`: کادر مختصات

```ts
type AxesSpec = {
  xDomain: [number, number]
  yDomain: [number, number]
  rect: [number, number, number, number]   // کسری از صحنه: [x, y, w, h]
  ticks?: { x?: number; y?: number }       // سقف 40
  labels?: { x?: string; y?: string }
  grid?: boolean
  arrows?: { x?: boolean; y?: boolean }
}
```

فرزندان یک `axes` در **واحدهای دادهٔ** آن مکان می‌گیرند: `x: 2` یعنی «۲ روی
این محور»، نه «۲ پیکسل». چند `axes` در یک صحنه یعنی چند پنل که یک ساعت را به
اشتراک می‌گذارند. این جای `scene.panels` و `plotSpace` نسخهٔ ۱ را می‌گیرد.

`rect` را کمی کوچک‌تر از `[0,0,1,1]` بگیرید تا جای تیک و برچسب محور بماند:
`[0.07, 0.06, 0.9, 0.8]`.

### ۸.۴ — `plot`

```ts
{ type: 'plot', expr: '0.5*x^2', domain: [0, 8], samples: 160 }
```

داخل نمودار `x` متغیر محور است و `t` همچنان ساعت صحنه. برای منحنی‌ای که
تابعی از x نیست (مارپیچ، لیستور) از `parametric: { xExpr, yExpr }` استفاده کنید
که در `u` ارزیابی می‌شود.

این تفکیک است چیزی است که در نسخهٔ ۱ غیرممکن بود: آنجا `t` هم ساعت بود و هم
متغیر محور، پس موج روندهٔ `A*sin(k*x - w*t)` اصلاً نوشته نمی‌شد.

نمونه‌های غیرمتناهی حذف می‌شوند و خط به آن‌ها کشیده نمی‌شود. `samples` در
`LIMITS.maxPlotSamples` (۲۰۰۰) سقف می‌خورد.

### ۸.۵ — `use` و قالب‌ها

```ts
{ id: 'a1', type: 'use', template: 'freeBodyDiagram',
  transform: { x: 100, y: 50 },
  props: { rotation: { expr: 'deg(t)' } } }
```

بسط `use` خالص و قطعی است: همان انیمیشن همیشه همان درخت را می‌دهد. عمق بسط در
`LIMITS.maxTemplateDepth` (۸) محدود است و قالبی که خودش را صدا بزند گزارش
می‌شود و نادیده گرفته می‌شود.

## ۹. `Template`

```ts
type Template = {
  id: string
  name: string
  description?: string
  params?: Record<string, Param>
  nodes: Node[]
}
```

پارامترهای یک قالب در دامنهٔ کامپایل قالب هم هستند؛ به همین دلیل قالبی که
`vx` را صدا می‌زند پر از «شناسهٔ ناشناخته» نیست.

---

## ۱۱. `QuestionBank` و `BankQuestion`

```ts
type BankQuestion = {
  id: string
  stem: string                 // الزامی و ناتَهیچ — بدون آن سؤال حذف می‌شود
  options: string[]
  answerIndex: number          // اینجا کلمپ می‌شود
  explanation?: string
  /**
   * پاسخ‌نامهٔ تشریحی: یک اسلاید کامل، پس می‌تواند هر کادری داشته باشد
   * — از متن و فرمول تا تصویر و انیمیشن. کادرها همان union بند ۶ هستند.
   */
  answerKey?: { title?: string; steps: SlideStep[] }
  tags: string[]               // مسیر سلسله‌مراتبی، ریشه اول
  source?: string
  year?: number
  difficulty?: 1 | 2 | 3       // پیش‌فرض 2
  starred?: boolean
  createdAt: number
  updatedAt: number
  used?: number
}
```

| میدان | رفتار ورود |
| --- | --- |
| `stem` | اگر رشته نباشد یا فقط فاصله باشد ⇒ **سؤال کاملاً حذف می‌شود** |
| `options` | غیررشته‌ها حذف می‌شوند |
| `answerIndex` | به بازهٔ `[0, options.length - 1]` کلمپ می‌شود (برخلاف `quiz`) |
| `tags` | آرایهٔ رشته‌ها، یا رشتهٔ `a:b:c` که با `:` شکسته و trim می‌شود |
| `difficulty` | عدد ۱ تا ۵؛ بیرون از این بازه ⇒ `3` |
| `answerKey` | از همان مهاجرت کادرهای اسلاید می‌گذرد؛ اگر `steps` خالی باشد حذف می‌شود |
| `starred` | فقط `true` دقیقاً |

بانک دو شکل ورودی می‌پذیرد — یک شیء با `questions`، یا آرایهٔ خام:

```json
{ "schema": 1, "questions": [], "updatedAt": 0 }
```

```json
[]
```

خروجی `ingestBank` در حالت خطا پیام
`فایل بانک سؤال معتبر نیست` می‌دهد.

---

## ۱۲. فهرست کامل مقادیر مجاز

| enum | مقادیر | پیش‌فرض |
| --- | --- | --- |
| `BlockSpan` | `full` `half` `third` | بر اساس `kind` |
| `StepKind` | `text` `list` `formula` `callout` `trap` `image` `video` `code` `quiz` `animation` | — |
| `CalloutTone` | `info` `tip` `warn` `idea` | `info` |
| `Interp` | `linear` `ease` `easeIn` `easeOut` `step` | `ease` |
| `AnimShape` | `circle` `square` `triangle` `arrow` `car` `ball` | `ball` |
| `SeriesStyle` | `line` `dashed` `dots` `fill` | `line` |
| `AnimProp` | `x` `y` `size` `rotation` `opacity` | — |
| `plotSpace` | `time` `free` | `time` |
| `PresentationTheme` | `light` `dark` `paper` | `light` |
| `layout` | `flow` `stack` | `flow` |
| `Difficulty` | `1` خیلی آسان · `2` آسان · `3` متوسط · `4` سخت · `5` خیلی سخت | `3` |

رنگ‌ها: هر رشتهٔ معتبر CSS. رنگ‌های پیش‌فرض هر کتابخانه در
`src/lib/anim/presets.ts` و `KIND_ACCENT` در `src/types.ts`.

---

## ۱۳. زبان فرمول

دو کامپایلر وجود دارد و هر دو **بدون `eval` و بدون `Function`** — یعنی فرمول
کاربر هیچ‌وقت به globalهای صفحه دسترسی ندارد.

| | نسخهٔ ۱ — `src/lib/anim/expr.ts` | نسخهٔ ۲ — `src/lib/anim2/expr.ts` |
| --- | --- | --- |
| متغیرها | فقط `t` | `t`, `lt`, `x`, `u`, `duration`, هر `param`، ارجاع `@id.prop` |
| شرط | ندارد | `< > <= >= == != && || !` و `if(c,a,b)` |
| ضرب ضمنی | ندارد | `2t`، `3(t+1)`، `2pi`، `(a)(b)` |
| مشتق | ندارد | `d(expr)` |
| ارجاع بین‌گرهی | ندارد | `@body.x`، `@plot.at(x)` |
| بازخورد ویرایشگر | `check(src)` ⇒ `{ ok, error, at }` | `validateExpr(src, scope)` ⇒ `{ ok, deps }` \| `{ ok:false, message, pos }` |

> `check(src)` نسخهٔ ۱ **دست‌نخورده** مانده است؛ ویرایشگر قدیمی هنوز از آن
> استفاده می‌کند.

### ۱۳.۱ — نسخهٔ ۲

| بخش | دقیقاً چه چیزهایی |
| --- | --- |
| متغیر | `t` (ساعت صحنه)، `lt` (زمان محلی گره)، `x` (متغیر محور)، `u` (پارامتر منحنی)، `duration` |
| ثابت | `pi` `e` `tau` `phi` |
| عملگر | `+ - * / % ^` (توان راست‌شرکت‌پذیر)، `< > <= >= == !=`، `&& || !` |
| ضرب ضمنی | `2t`، `3(t+1)`، `2pi`، `(a)(b)` |
| تابع | `sin cos tan asin acos atan sinh cosh tanh sqrt abs exp ln log log2 log10 floor ceil round trunc frac sign mod pow min max hypot atan2 deg rad clamp lerp smoothstep step if dist dot len` |
| ویژه | `d(expr)` مشتق نسبت به `t` |
| عدد | اعشاری و **ارقام فارسی/عربی** (`۲٫۵` = `2.5`)، و توان علمی (`1.5e3`) |
| شناسه | حساس به بزرگی/کوچکی حروف، و می‌تواند فارسی باشد: `شتاب` |

`atan2` رادیان برمی‌گرداند. `rotation` همیشه **درجه** است، پس بنویسید
`deg(atan2(vy, vx))`.

#### نام‌های رزرو‌شده

`RESERVED` صادر می‌کند: `t`, `lt`, `x`, `u`, `duration`, `time`, `زمان`, `pi`,
`e`, `tau`, `phi`, `true`, `false`, `if`, `and`, `or`, `not` و نام همهٔ توابع.
تعریف یک متغیر با این نام‌ها باید هنگام ورود رد شود، نه هنگام رندر.

#### مواردی که خطا می‌دهند

* `t**2` → باید `t^2`
* `v = 2*t` → `=` پشتیبانی نمی‌شود
* نام تعریف‌نشده (`a`, `g`) ⇒ خطا
* تابع ناشناخته ⇒ خطا
* تقسیم بر صفر ⇒ `Infinity` (که هنگام رسم نمونه حذف می‌شود، نه اینکه کل منحنی را
  از بین ببرد)

### ۱۳.۲ — خطا هیچ‌وقت رندر را نمی‌شکند

| حالت | نتیجه |
| --- | --- |
| فرمول خالی | مقدار پیش‌فرض |
| فرمول نامعتبر | مقدار پیش‌فرض + یک هشدار در `compiled.warnings` |
| نتیجهٔ `NaN` | `0` — یک فرمول خراب نباید کل صحنه را سفید کند |
| ارجاع حلقوی | آن گره صفر + هشدار |
| فرمول بیش از ۵۰۰ نویسه | مقدار پیش‌فرض + هشدار |

پیام خطا فارسی است و **موقعیت نویسه** را دارد:
`شناسهٔ ناشناخته «foo» — ناحیهٔ ۵`.

### ۱۳.۳ — کارایی

* خروجی هر گره یک درخت بستهٔ توابع است؛ در حلقهٔ هر فریم **هیچ تخصیص
  حافظه‌ای** انجام نمی‌شود.
* `getSnapshot` ساعت را به‌صورت یک `number` برمی‌گرداند، پس
  `useSyncExternalStore` بر اساس مقدار مقایسه می‌کند.
* کش کامپایل LRU با سقف ۵۰۰ ورودی، و کلیدش شامل دامنه است — پس همان فرمول
  زیر دو دامنهٔ متفاوت می‌تواند متفاوت کامپایل شود.
* مشتق (`d()`) در زمان کامپایل ساخته می‌شود، نه در هر فریم.

---

## ۱۴. نشانه‌گذاری متن درون‌خطی

عبارت‌بندی دقیق (یک regex، بدون حالت تودرتو، بدون escape):

| الگو | نتیجه |
| --- | --- |
| `**متن**` | پررنگ |
| `*متن*` | مورب |
| `` `متن` `` | کد monospace |
| `==متن==` | هایلایت |
| `$فرمول$` | KaTeX درون‌خطی |
| `https://…` یا `www.…` | پیوند |

قواعد:

* هیچ‌کدام **تودرتو** نیستند: `**a *b* c**` به‌هم نمی‌ریزد ولی نتیجه‌اش
  همان متن خام است.
* هر الگو نمی‌تواند خط جدید داشته باشد.
* فرمول درون‌خطی بین `$...$` است و با KaTeX رندر می‌شود؛ خطای KaTeX
  فقط متن را قرمز می‌کند.
* **پشتیبانی نمی‌شود**: `#` عنوان، `-`/`1.` فهرست، `>` نقل‌قول،
  جدول مارک‌داون، بلوک کد سه‌_backtick، لینک `[متن](url)`.
* قطعه‌های لاتین داخل متن فارسی با `unicode-bidi: isolate` جدا می‌شوند تا
  فرمول و کد، چیدمان خط فارسی را برعکس نکنند.
* در `text` خط جدید ⇒ `<br>`؛ در `list` هر عضو یک `li` است.

---

## ۱۵. کلیدهای ذخیره‌سازی

| کلید | محتوا | نسخه |
| --- | --- | --- |
| `smart-teach:presentations:v2` | `Presentation[]` | ۲ |
| `smart-teach:question-bank:v1` | `QuestionBank` | ۱ |
| `smart-teach:progress:<presId>` | `{ step: number }` | — |
| `presentations` | کلید نسخهٔ ۱، فقط خوانده و سپس حذف می‌شود | ۱ |

اگر `presentations:v2` نباشد ولی `presentations` باشد، کلید قدیمی
مهاجرت داده و **پاک** می‌شود. پیشرفت ارائه هنگام بستن مرورگر از دست
می‌رود ولی با کلید جدا نگه داشته می‌شود تا پاک‌کردن ارائه آن را نبرد.

---

## ۱۶. API برنامه‌نویسی

### `src/storage.ts`

```ts
const K_PRES = 'smart-teach:presentations:v2'
const K_BANK = 'smart-teach:question-bank:v1'
const K_PROGRESS = 'smart-teach:progress:'

function loadPresentations(): Presentation[]
function savePresentation(pres: Presentation): Presentation[]
function deletePresentation(id: string): Presentation[]
function duplicatePresentation(id: string): Presentation | undefined
function importPresentations(input: unknown): Presentation[]
function downloadJSON(value: unknown, filename: string): void
function safeFilename(name: string): string

function loadBank(): QuestionBank
function saveBank(next: QuestionBank): QuestionBank
function upsertQuestion(q: BankQuestion): QuestionBank
function deleteQuestion(id: string): QuestionBank
function importBank(input: unknown): QuestionBank

function loadProgress(id: string): number | undefined
function saveProgress(id: string, step: number): void
function clearProgress(id: string): void

function migratePresentation(raw: unknown): Presentation | null
function migrateQuestion(raw: unknown): BankQuestion | null
```

`savePresentation` خودش `schema` را به ۲ و `updatedAt` را به «الان»
می‌نویسد و در `id` موجود به‌روزرسانی می‌کند، در غیر این صورت اضافه
می‌کند. `duplicatePresentation` کپی عمیق با `id` تازه و عنوان
«… (کپی)» می‌سازد.

### `src/lib/sync.ts`

```ts
function syncOnBoot(): Promise<void>   // سرور جایگزین کش می‌شود
function flushPending(): Promise<void>  // خالی‌کردن صف تغییرات آفلاین
function pushLocalToServer(): Promise<{questions, presentations}>  // یک‌باره، با دکمه
function pendingCount(): number
function useSyncState(): SyncState     // 'starting' | 'online' | 'offline'
const BASE: string                     // VITE_API_URL یا http://localhost:5178
const api: {
  health(): Promise<unknown>
  questions(): Promise<BankQuestion[] | null>
  saveQuestions(list: unknown[]): Promise<unknown>
  deleteQuestion(id: string): Promise<unknown>
  presentations(): Promise<Presentation[] | null>
  savePresentation(p: Presentation): Promise<unknown>
  bulkPresentations(list: Presentation[]): Promise<unknown>
  deletePresentation(id: string): Promise<unknown>
  saveProgress(id: string, step: number): Promise<unknown>
  getProgress(id: string): Promise<{ step?: number } | null>
}
```

**PostgreSQL منبع حقیقت است.** `syncOnBoot` یک بار در `src/app/BootSync.tsx`
اجرا می‌شود: سطرهای سرور **جایگزین** کش می‌شوند و بعد `refreshStores()` صدا
می‌زند. نوشتن‌ها اول در کش می‌نشینند (تا رابط فوری باشد) و سپس به API می‌روند؛
اگر API در دسترس نباشد، در `smart-teach:pending:v1` صف می‌شوند و در بار بعد
که سرور جواب داد، به ترتیب خالی می‌شوند.

### سرور (Next Route Handlers + Prisma)

| مسیر | بدنه | کار |
| --- | --- | --- |
| `GET /api/health` | — | `{ ok, questions, presentations }` |
| `GET /api/questions` | — | همهٔ سؤال‌ها |
| `POST /api/questions` | `BankQuestion[]` | upsert گروهی |
| `POST /api/questions/bulk` | آرایه یا `{questions}` | `{ saved, rejected: [{index, reason}] }` |
| `PUT /api/questions/:id` | `BankQuestion` | upsert تکی |
| `DELETE /api/questions/:id` | — | `{ id }` |
| `GET /api/presentations` | — | همهٔ ارائه‌ها |
| `GET/PUT/DELETE /api/presentations/:id` | `Presentation` | — |
| `POST /api/presentations/bulk` | آرایه | `{ saved }` |
| `GET/PUT /api/progress/:id` | `{ step }` | آخرین گام ارائه |

همهٔ ورودی‌ها از همان `migrate*` رد می‌شوند، پس سرور و مرورگر یک قانون دارند.

### `src/lib/store.ts`

```ts
function usePresentations(): Presentation[]          // useSyncExternalStore
function useBank(): QuestionBank
function useQuestions(): BankQuestion[]

function putPresentation(pres: Presentation): void
function removePresentation(id: string): void
function copyPresentation(id: string): Presentation | undefined
function ingestPresentations(input: unknown): Presentation[]
function putQuestion(q: BankQuestion): void
function removeQuestion(id: string): void
function ingestBank(input: unknown): QuestionBank
```

هر `put*` از لایهٔ `storage` عبور می‌کند و `localStorage` را به‌روز می‌کند؛
بنابراین رندر خودکار است و نیازی به reload نیست.

### `src/lib/anim/engine.ts`

```ts
function easeFactor(kind: Interp, u: number): number
function sortKeys(keys: AnimKey[]): AnimKey[]
function sampleKeys(keys: AnimKey[] | undefined, t: number, fallback?: number): number
function seriesValue(s: AnimSeries, t: number): number          // NaN اگر خراب
function seriesPath(s, from, to, sx, sy, steps?): string        // '' اگر to <= from
function seriesSlope(s: AnimSeries, t: number): number          // مشتق مرکزی، h = 0.005
function lastFinite(s: AnimSeries, t: number): number
function seriesExtent(s, duration, steps?): [number, number]    // کمینه/بیشینه برای قاب‌بندی
function seriesLookupOf(anim): (id: string, t: number) => number | undefined
function layerPos(layer, t, lookup?): { x, y }
function layerState(layer, t, lookup?): LayerState
function layerVelocity(layer, t, lookup?): { x, y }
function layerAcceleration(layer, t, lookup?): { x, y }
function speed(v: { x, y }): number
function readout(layer, t, lookup?): Readout
function currentValue(layer, prop, t, lookup?): number
function trailPoints(layer, t, lookup?): { x, y }[]
function niceStep(raw: number): number
function ticksFor(lo: number, hi: number, target: number): number[]
function fitDomains(anim): Pick<AnimScene, 'xMin' | 'xMax' | 'yMin' | 'yMax'>
function keyframeExtent(anim): number                            // بزرگ‌ترین t در همهٔ کلیدها
function allKeyframes(anim): { t; prop: AnimProp; layerId; keyId }[]
function withKey(layer, prop, t, value?, patch?) => AnimLayer
function withoutKey(layer, prop, keyId) => AnimLayer
function animationDuration(anim): number
function wrapTime(t, anim): number
```

نکته‌های امضا:

* `sampleKeys(undefined | [], …)` ⇒ `fallback`؛ با یک کلید ⇒ همان مقدار؛
  خارج از بازهٔ اولین/آخرین کلید ⇒ مقدار کلید مرزی (بدون extrapolate).
* `seriesPath` بین `from` و `to` **نمونه‌برداری** می‌کند (پیش‌فرض حداکثر
  ۲۲۰ نقطه) و هر نقطهٔ `NaN` قلم را بالا می‌برد ⇒ مسیر شکسته با پرش.
  اگر `to <= from` رشتهٔ خالی برمی‌گرداند، یعنی با `reveal: true` در لحظهٔ
  `t = 0` **هیچ چیزی رسم نمی‌شود** — طبیعی است، ولی در اسکرین‌شاتِ لحظهٔ صفر
  صحنه خالی به‌نظر می‌رسد.
* `fitDomains` همان قاب‌بندی خودکاری است که استودیو با دکمهٔ «قاب‌بندی»
  انجام می‌دهد؛ برای فایل‌های تولیدشده، دستی‌نویسی `yMin`/`yMax` دقیق‌تر است.

### `src/lib/anim/expr.ts`

```ts
function compile(src: string): ((t: number) => number) | null
function check(src: string): { ok: true } | { ok: false; error: string; at: number }
function evalExpr(src: string, t: number, fallback?: number): number
const EXPR_FUNCS: string[]
const EXPR_EXAMPLES: { label: string; expr: string }[]
```

---

## ۱۷. مسیرها

| مسیر | صفحه | توضیح |
| --- | --- | --- |
| `/` | — | `redirect` به `/create` |
| `/create` | ویرایشگر | `?slide=<slideId>` اسکرول تا آن بخش |
| `/bank` | بانک سؤال | — |
| `/view/:id` | ارائه‌دهنده | `?step=<شمارهٔ کلی>` شروع از گام مشخص |
| `/studio/:presId/:slideId/:stepId` | استودیوی انیمیشن | — |
| هر چیز دیگر | — | `redirect` به `/create` |

`/studio` از هر مسیری فقط یک انیمیشن را ویرایش می‌کند؛ آن را در
localStorage ذخیره می‌کند (debounce ۷۰۰ms) و پس از بستن، پنجرهٔ تازه‌ای روی
همان ارائه باز می‌کند.

میان‌برهای اجرا (`/view`): `Space`/`←` بعد، `→` قبل، `G` نمای کل،
`B` صفحهٔ سیاه، `N` یادداشت، `T` تایمر، `D` تیره، `F` تمام‌صفحه،
`+`/`-` بزرگ‌نمایی، `Ctrl+G` پرش به گام.

---

## ۱۸. خطاها

| پیام | معنی |
| --- | --- |
| `فایل JSON معتبر نیست` | `importPresentations` هیچ ارائهٔ معتبری از ورودی درنیاورد |
| `فایل بانک سؤال معتبر نیست` | `importBank` هیچ سؤال معتبری درنیاورد |
| `حافظهٔ مرورگر پر است؛ از دکمهٔ «خروجی» پشتیبان بگیرید.` | `localStorage.setItem` پرتاب کرده (سقف ~۵MB) |

خطاهای بی‌صدا — یعنی هیچ پیامی نمی‌بینید ولی چیزی نمایش داده نمی‌شود:

| نشانه | علت محتمل |
| --- | --- |
| منحنی رسم نمی‌شود | `expr` خالی/نامعتبر، یا مقدارش `NaN` است، یا `visible: false` |
| منحنی بیرون از کادر است | `yMin`/`yMax` بازه را نمی‌پوشاند |
| جسم سر جایش است | `mode: 'expr'` ولی `exprX` خالی، یا `mode: 'key'` بدون `tracks.x` |
| هیچ پرسشی درست نیست | `answerIndex >= options.length` |
| کادر متن به‌جای نوع اصلی نمایش داده می‌شود | `kind` اشتباه/ناشناخته ⇒ به `text` تبدیل شده |
| `NaN` روی صحنه | `duration` صفر یا منفی، یا کلیدهای زمانی خارج از بازه |

---

## ۱۹. نسخه‌بندی و مهاجرت

* `SCHEMA_VERSION = 2`. این عدد **نادیده گرفته و بازنویسی** می‌شود؛ برنامه
  بر اساس شکل داده تصمیم می‌گیرد، نه بر اساس عدد نسخه.
* تنها مسیر مهاجرت پشتیبانی‌شده `v1 → v2` است: کادرهای بدون `id` و بدون
  `span` شناسه و عرض می‌گیرند، `kind`های ناشناخته به متن تبدیل می‌شوند، و
  آرایهٔ ارائه‌های قدیمی به کلید `v2` منتقل می‌شود.
* اگر ساختار داده را عوض کردید: `SCHEMA_VERSION` را بالا ببرید، یک تابع
  مهاجرت بنویسید که **نسخهٔ قبلی را هم بپذیرد** و بی‌صدا محتوا را دور
  نریزد — همین سیاست فعلی است (`KIND_LABEL` به‌عنوان نگهبان نوع ناشناخته).
* پشتیبان‌گیری: `downloadJSON(library, 'presentations')` کل کتابخانه را
  می‌دهد و `importPresentations` دوباره می‌خواند. این تنها مسیر پشتیبان
  رسمی است.

---

## ۱۹ب. حالت ضبط (Record)

استودیو یک حالت **ضبط** دارد که برای ساخت حرکتِ بدون فرمول و بدون
دست‌کاری دستیِ خط زمان است:

* با دکمهٔ ضبط (یا کلید `R`) روشن می‌شود.
* جسم را **می‌کشید و رها می‌کنید**؛ هر بار رها کردن یک کی‌فریم در ثانیهٔ
  فعلی می‌نویسد (`tracks.x` و `tracks.y`) و لایه خودکار به `mode: 'key'`
  سوئیچ می‌کند.
* ساعت بعد از هر رها کردن یک **ضرب** جلو می‌رود (پیش‌فرض ۰٫۵ ثانیه)، پس
  ترتیب کی‌فریم‌ها = ترتیب حرکت‌های شما = ترتیب پخش.
* اگر چیزی زیر نشانگر نبود ولی جسم از فهرست انتخاب شده باشد، رها کردن در
  هر نقطه از پنلِ آن، همان جسم را جابه‌جا می‌کند.
* «ثبت وضعیت همهٔ اجسام» همهٔ اجسام را در ثانیهٔ فعلی ثبت می‌کند؛
  «پاک کردن» کی‌فریم‌های جسم انتخاب‌شده را پاک می‌کند.

خروجی، همان دادهٔ معمولی است: پس از ضبط می‌توانید کی‌فریم‌ها را مثل همیشه
ویرایش، حذف یا مرتب کنید.

---

## ۱۹ج. افزوده‌های v2 (متغیر، شرط، رسم، لنگر، شکل، کنترل)

### متغیرهای صحنه

```ts
type Animation2 = {
  vars?: Record<string, string>   // نام → فرمول
}
```

نام‌ها به ترتیب وابستگی مرتب می‌شوند؛ چرخه گزارش می‌شود (`cyclic`) و به‌جای
عدد غلط صفر برمی‌گردد. نام‌های رزرو‌شده (`t`, `lt`, `x`, `u`, `duration`,
`d`, نام توابع) نادیده گرفته و هشدار می‌گیرند.

### شرط‌ها و ذرات

```ts
type AnimEventDef = {
  id: string
  when: string              // شرط بولی
  actions: AnimAction[]
  once?: boolean            // پیش‌فرض true
  cooldown?: number         // ثانیه
}
```

روی **لبهٔ صعودی** اجرا می‌شوند. `spawnParticles` در `lib/anim2/particles.ts`
استخری با سقف سخت دارد؛ نقطهٔ `at` در واحدهای خودِ صحنه است.

### رسم‌ها

```ts
type Drawing = ArrowDrawing | DimensionDrawing | ProtractorDrawing | LabelDrawing
```

زیر گره‌ها کشیده می‌شوند و کادر انتخاب ندارند.

### لنگرها

```ts
node.anchors = { top: { x: 0, y: '-r' } }
```

با `@id@name.x` و `@id@name.y` خوانده می‌شود؛ لنگر با چرخش گره می‌چرخد.

### شکل‌ها

```ts
type ShapeDef = { path: string; params?: Record<string, NumProp>; offset?: {...} }
```

در مسیر، `w` `h` `r` `a` `n` اعدادِ آزادند و با پارامترهای گره جایگزین
می‌شوند. حروف فرمان (`M`, `L`, …) جانشین نمی‌شوند مگر آنکه جای مقدار نیایند.

### کنترل‌ها

```ts
param.control = 'slider' | 'toggle' | 'select' | 'button'
param.options  // برچسب‌های select
param.actions  // کنش‌های دکمه
param.pulseFor // ثانیه تا بازگشت
```

همه روی یک عدد می‌نشینند، پس `when: "show == 1"` برای toggle درست است.
پرچم قدیمی `slider` هنوز کار می‌کند.

### پخش

```ts
playback: { segments?, pingPong?, startAt?, stopAt?, rate? }
```

بخش‌ها هم‌پوشان ادغام و وارونه جابه‌جا می‌شوند؛ ساعت همیشه یک مرز معتبر دارد.

### برون‌بری

`lib/anim2/exporters.ts` — `exportScene(svg, 'svg' | 'png' | 'pdf')`.
متغیرهای CSS پیش از سریال‌سازی درون‌خطی می‌شوند، وگرنه فایل خروجی بی‌رنگ
می‌شود. PDF از راه رسترکردن PNG ساخته می‌شود، چون PDF بدون موتور قلم
متن را نمی‌چیند.

## ۲۰. حدود و نکات

| حد | مقدار |
| --- | --- |
| سقف عملی `localStorage` | ~۵MB برای همهٔ کلیدها با هم |
| طول عنوان هر کادر | بی‌حد؛ ولی متن بلند یعنی ارائه‌دهنده می‌خواند |
| تعداد کادر در یک بخش | عملی: ۶؛ فراتر از آن در اجرا جا نمی‌شود |
| گزینه‌های پرسش | رابط تا ۸، کلیدها تا ۱۲ (`1`–`6`, `a`–`f`) |
| سختی | ۱ تا ۵ |
| ورود گروهی | `/bank/import` — JSON را می‌پذیرد و پیش از ذخیره پیش‌نمایش می‌دهد |
| گام‌های قابل پیمایش در اجرا | بدون محدودیت؛ نوار پیشرفت کل ارائه |
| تصویر/ویدیو | فقط URL — فایل محلی (`file://` یا آدرس نسبی) بارگذاری نمی‌شود |
| `xTicks`/`yTicks` | هر عددی؛ به «تعداد هدف» تبدیل می‌شود و به عدد گرد شده |
| `layers` جاافتاده | `emptyAnimation()` یک لایهٔ پیش‌فرض (`ball`) در مبدأ می‌سازد؛ اگر لایه نمی‌خواهید `layers: []` بنویسید |
| `aspect` | باید ایجابی باشد؛ `0` باعث `viewBox` با ارتفاع صفر می‌شود |
| `duration` | `0` باعث تقسیم بر صفر در اسلایدر و درون‌یابی می‌شود |

سه قانون که بیشترین خطا را در فایل‌های تولیدشده می‌سازند:

1. **`layers` و `series` را کامل بنویسید.** برخلاف بقیهٔ ساختار، هیچ
   پیش‌فرضی ندارند.
2. **`answerIndex` صفرپایه است و کلمپ نمی‌شود.**
3. **`id`ها یکتا باشند.** تکرار یعنی بازنویسی بی‌صدای ارائهٔ قبلی.