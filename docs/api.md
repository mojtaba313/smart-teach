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

## ۷. `Animation`

```ts
type Animation = {
  title: string
  duration: number      // ثانیه
  loop: boolean
  autoplay: boolean
  speed: number         // ضریب سرعت پخش
  scene: AnimScene
  layers: AnimLayer[]
  series: AnimSeries[]
  readout: boolean      // جعبهٔ زندهٔ x/v/a
}
```

| میدان | پیش‌فرض | اثر |
| --- | --- | --- |
| `title` | `'حرکت‌شناسی'` | بالای صحنه و برچسب کادر در ویرایشگر |
| `duration` | `6` | طول محور زمان در حالت `time` |
| `loop` | `true` | پخش بی‌نهایت؛ `false` یعنی روی `duration` می‌ایستد |
| `autoplay` | `true` | در اجرا بدون کلیک شروع می‌شود |
| `speed` | `1` | مثلاً `0.5` = نیم‌سرعت |
| `readout` | `true` | جدول `x, y, vx, vy, |v|, ax` روی صحنه |

قواعد عملی:

* `duration` باید ≥ بیشترین `t` در کی‌فریم‌ها و ≥ `duration` انتظارشدهٔ
  فرمول‌ها باشد، وگرنه استودیو هشدار «بخشی از حرکت دیده نمی‌شود» می‌دهد.
* در استودیو `Space` پخش/مکث، کشیدن روی صحنه = جابه‌جایی دستی زمان،
  `←`/`→` گام‌به‌گام با `Shift` برای ۰٫۵ ثانیه، `Home`/`End` ابتدا/انتها.
* `follow` فقط در `plotSpace: 'time'` معنی‌دار است.

---

## ۸. `AnimScene`

```ts
type AnimScene = {
  plotSpace: 'time' | 'free'
  xMin: number; xMax: number
  yMin: number; yMax: number
  aspect: number
  showAxes: boolean
  showGrid: boolean
  xLabel: string
  yLabel: string
  xTicks: number   // تعداد هدف، نه مقدار
  yTicks: number
  /** نمودارهای روی هم؛ نبودنشان = یک نمودار (همان رفتار قدیم) */
  panels?: AnimPanel[]
  /** فاصلهٔ عمودی نمودارها، بر حسب واحد view-box */
  panelGap?: number
}

type AnimPanel = {
  id: string
  /** عنوان گوشهٔ بالا-چپ همان نمودار، مثلاً `x (m)` */
  title?: string
  yMin: number
  yMax: number
  yLabel?: string
  yTicks?: number
}
```

مقادیر پیش‌فرض `emptyAnimation()`:

```json
{ "plotSpace": "time", "xMin": 0, "xMax": 6, "yMin": 0, "yMax": 30,
  "aspect": 0.62, "showAxes": true, "showGrid": true,
  "xLabel": "t (s)", "yLabel": "x (m)", "xTicks": 6, "yTicks": 6 }
```

| میدان | معنی دقیق |
| --- | --- |
| `plotSpace` | `time`: محور افقی = زمان، از ۰ تا `duration`. `free`: محور افقی = مختصات جهان. |
| `xMin`/`xMax` | در `time` **نادیده گرفته می‌شود**. در `free` بازهٔ افقی صحنه. |
| `yMin`/`yMax` | بازهٔ عمودی. اگر ۰ داخلش نباشد، محور افقی به پایین کادر می‌چسبد. |
| `aspect` | نسبت ارتفاع/عرض. `0.62` نمودار متعارف، `0.42` جاده/صحنهٔ کم‌ارتفاع، `0.3` خیلی پهن. |
| `xTicks`/`yTicks` | **تعداد هدف** تیک‌ها، نه مقدارشان. `ticksFor` گام را به یک عدد «گرد» می‌کند، پس تعداد واقعی می‌تواند کمی با عدد شما فرق کند. |
| `xLabel`/`yLabel` | رشتهٔ کوتاه. اگر `xLabel` خالی باشد اصلاً رسم نمی‌شود. |

**نمودارهای روی هم (`panels`).** برای x(t)، v(t) و a(t) کنار هم، به‌جای سه
صحنهٔ جدا، یک صحنه با چند پنل بسازید: همهٔ پنل‌ها **یک ساعت** دارند، پس
عمودی مقایسه‌شونده است. `scene.yMin`/`yMax`/`yLabel`/`yTicks` در این حالت
نادیده گرفته می‌شوند و هر پنل دامنهٔ خودش را دارد:

```json
{ "plotSpace": "time", "aspect": 0.86, "panelGap": 10,
  "panels": [
    { "id": "p1", "title": "جاده",     "yMin": -1, "yMax": 1,  "yTicks": 2 },
    { "id": "p2", "title": "x (m)",    "yMin": -4, "yMax": 32, "yTicks": 4 },
    { "id": "p3", "title": "v (m/s)",  "yMin": -1, "yMax": 18, "yTicks": 4 },
    { "id": "p4", "title": "a (m/s²)", "yMin": -1, "yMax": 6,  "yTicks": 4 }
  ] }
```

هر `series` و هر `layer` با `panel` روی یکی از این‌ها می‌نشیند؛
`layer.panel: "*"` یعنی در **همهٔ** پنل‌ها (برای نقطه‌ای که روی نمودار
می‌سُرد). پنل اول پیش‌فرض است.

**قانون قاب‌بندی.** تابع هر فرمول را روی `[0, duration]` حساب کنید، کمینه و
بیشینه را بردارید و حدود ۱۰٪ بیرون‌تر را به‌عنوان `yMin`/`yMax` بگذارید:

| فرمول | duration | بیشینه | `yMin`, `yMax` پیشنهادی |
| --- | --- | --- | --- |
| `2*t` | 6 | 12 | `-1`, `14` |
| `t*t + 3*t - 5` | 5 | 25 | `-3`, `30` |
| `v0*t - 0.5*9.8*t*t` | 4 | 16 (اوج) | `-2`, `18` |
| `-t*t + 6*t` | 5 | 9 | `-1`, `12` |

اگر `yMin ≤ 0 ≤ yMax` باشد، محور افقی دقیقاً روی `y = 0` می‌افتد؛ اگر ۰
خارج بازه باشد، محور به لبهٔ کادر می‌چسبد. اولی برای نمودارهای فیزیک
درست‌تر است.

---

## ۹. `AnimSeries`

```ts
type AnimSeries = {
  id: string
  label: string
  expr: string        // فرمول بر حسب t، بدون «=»
  color: string       // #rrggbb
  style: 'line' | 'dashed' | 'dots' | 'fill'
  visible: boolean
  reveal: boolean
  tangent?: boolean
  secant?: boolean
}
```

```json
{ "id": "s-x", "label": "x = 3t", "expr": "3*t", "color": "#7c3aed",
  "style": "line", "visible": true, "reveal": true,
  "tangent": true, "secant": false }
```

| میدان | معنی رندر |
| --- | --- |
| `id` | کلید ارجاع برای `AnimLayer.follow` |
| `label` | راهنمای بالای صحنه و برچسب قاطع `v̄` |
| `expr` | فقط زبان بند ۱۳؛ خراب ⇒ بی‌صدا حذف از مسیر |
| `style: line` | خط ممتد |
| `style: dashed` | خط‌چین — برای منحنی مرجع |
| `style: dots` | ۲۵ نقطهٔ نمونه |
| `style: fill` | ناحیهٔ پرشده زیر منحنی (۱۵٪ شفافیت) — برای «مساحت زیر نمودار» |
| `reveal` | `true`: منحنی فقط تا لحظهٔ جاری کشیده می‌شود + نقطهٔ سر و خط عمودی راهنما. `false`: کل منحنی از ابتدا. |
| `tangent` | خط مماس در playhead با برچسب `v = <شیب>` |
| `secant` | خط قاطع از `t=0` تا playhead با برچسب `v̄` |
| `visible: false` | رسم نمی‌شود ولی در آمار استودیو «پنهان» شمرده می‌شود |

`reveal: true` + `tangent/secant` ترکیب استاندارد «ساخته‌شدن نمودار همراه با
سرعت لحظه‌ای و متوسط» است.

---

## ۱۰. `AnimLayer` و `AnimKey`

```ts
type AnimProp = 'x' | 'y' | 'size' | 'rotation' | 'opacity'
type Interp = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'step'

type AnimKey = {
  id: string
  t: number      // ثانیه — باید صعودی و یکتا باشد
  v: number      // مقدار
  interp: Interp // شیب قطعه‌ای که از همین کلید شروع می‌شود
}

type AnimLayer = {
  id: string
  name: string
  shape: 'circle' | 'square' | 'triangle' | 'arrow' | 'car' | 'ball'
  color: string
  visible: boolean
  mode: 'key' | 'expr' | 'follow'
  exprX: string
  exprY: string
  follow?: string
  tracks: Partial<Record<AnimProp, AnimKey[]>>
  showTrail: boolean
  showVelocity: boolean
  showAcceleration: boolean
  vectorScale: number
  label?: string
  /** panel id، یا '*' برای کشیدن در همهٔ پنل‌ها */
  panel?: string
  /** بردار مکان: از یک نقطهٔ ثابت تا خود جسم */
  positionVector?: {
    from: 'origin' | { x: number; y: number }
    color?: string
    label?: string
    dashed?: boolean
    visible?: boolean
  }
  vectors?: {
    velocity?: boolean
    acceleration?: boolean
    /** px به ازای هر واحد بر ثانیه؛ در نبود، `vectorScale` */
    scale?: number
    /** تجزیهٔ a به aₜ (مماسی) و aₙ (نرمال) — برای مارپیچ */
    decomposition?: boolean
  }
}
```

### سه حالت

هر کدام را جداگانه داخل `layers` بگذارید. حالت اول — فرمولی:

```json
{ "id": "l-car", "name": "خودرو", "shape": "car", "color": "#e11d48",
  "visible": true, "mode": "expr", "exprX": "2.4*t - 9", "exprY": "0",
  "tracks": { "size": [{ "id": "k1", "t": 0, "v": 2, "interp": "linear" }] },
  "showTrail": false, "showVelocity": true, "showAcceleration": true,
  "vectorScale": 10 }
```

حالت دوم — کی‌فریمی (بقیهٔ میدان‌ها پیش‌فرض می‌مانند):

```json
{ "id": "l-ball", "name": "توپ", "shape": "ball", "color": "#f97316",
  "visible": true, "mode": "key", "exprX": "t * 20", "exprY": "0",
  "showTrail": true, "showVelocity": false, "showAcceleration": false,
  "vectorScale": 12,
  "tracks": {
    "x": [{ "id": "k1", "t": 0, "v": -6, "interp": "linear" },
          { "id": "k2", "t": 3, "v":  2, "interp": "easeOut" }],
    "y": [{ "id": "k3", "t": 0, "v": 0, "interp": "linear" }],
    "size": [{ "id": "k4", "t": 0, "v": 5, "interp": "linear" }]
  } }
```

حالت سوم — سوار بر یک منحنی (`follow` باید به `id` یک `series` اشاره کند):

```json
{ "id": "l-dot", "name": "نقطهٔ تماس", "shape": "circle", "color": "#7c3aed",
  "visible": true, "mode": "follow", "follow": "s-x", "exprX": "0", "exprY": "0",
  "showTrail": false, "showVelocity": false, "showAcceleration": false,
  "vectorScale": 10,
  "tracks": { "size": [{ "id": "k5", "t": 0, "v": 0.6, "interp": "linear" }] } }
```

### جدول میدان‌ها

| میدان | معنی دقیق |
| --- | --- |
| `name` | فقط برچسب فهرست استودیو |
| `label` | متن کنار جسم روی صحنه |
| `shape` | شکل هندسی؛ `arrow` نوک پیکان به سمت مثبت x دارد |
| `size` (داخل `tracks`) | **کسری از ارتفاع پنل.** `0.14` یعنی ۱۴٪ ارتفاع پنل، پس در پنل کوتاه و بلند یکسان دیده می‌شود. |
| `showTrail` | ردّ حرکت؛ در حالت `key` خط‌چین، در `expr` ممتد |
| `showVelocity`/`showAcceleration` | فلش `v` و `a` با رنگ لایه (و مشکی برای `a`) |
| `vectorScale` | پیکسل به‌ازای هر واحد/ثانیه. فلش‌ها اگر کوتاه‌تر از ۱۰px شوند اصلاً رسم نمی‌شوند. |
| `mode: follow` | مختصات = `(t, value of series)`؛ فقط با `plotSpace: 'time'` |
| `positionVector` | پیکان از مبدأ (یا نقطهٔ دلخواه) تا جسم. زاویه‌اش خودکار است، پس هیچ‌وقت آینه‌ای زیر محور نمی‌افتد. |

نکته‌های runtime:

* `opacity` پیش‌فرض ۱؛ اگر جسم از کادر بیرون بزند (`∓80`px) با
  `opacity: 0.12` نمایش داده می‌شود، نه اینکه حذف شود.
* `rotation` بر حسب درجه.
* کلیدهای `x` و `y` باید بر اساس `t` صعودی باشند؛ رندر بین دو کلید
  درون‌یابی می‌کند.
* `mode: 'key'` بدون `tracks.x` ⇒ موقعیت صفر (`sampleKeys` مقدار پیش‌فرض
  می‌دهد)؛ یعنی جسم روی مبدأ می‌ماند بی‌آنکه خطایی بدهد.

---

## ۱۱. `QuestionBank` و `BankQuestion`

```ts
type BankQuestion = {
  id: string
  stem: string                 // الزامی و ناتَهیچ — بدون آن سؤال حذف می‌شود
  options: string[]
  answerIndex: number          // اینجا کلمپ می‌شود
  explanation?: string
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
| `difficulty` | غیر از ۱/۲/۳ ⇒ `2` |
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
| `Difficulty` | `1` `2` `3` | `2` |

رنگ‌ها: هر رشتهٔ معتبر CSS. رنگ‌های پیش‌فرض هر کتابخانه در
`src/lib/anim/presets.ts` و `KIND_ACCENT` در `src/types.ts`.

---

## ۱۳. زبان فرمول `expr`

کامپایلر بسته‌ای، **بدون `eval` و بدون `Function`** — یعنی فرمول کاربر
هیچ‌وقت به globalهای صفحه دسترسی ندارد.

| بخش | دقیقاً چه چیزهایی |
| --- | --- |
| متغیر | فقط `t` (و نام‌های هم‌معنی `time`, `زمان`) — زمان بر حسب ثانیه |
| ثابت | `pi` `π` `e` `tau` `phi` |
| عملگر | `+` `-` `*` `/` `%` `^` و معادل‌های فارسی `×` `÷` `−` `٪` |
| تابع | `sin cos tan asin acos atan sinh cosh tanh sqrt abs exp ln log floor ceil round sign atan2 min max pow mod hypot` |
| عدد | اعشاری، با `.` یا `٫`، و **ارقام فارسی/عربی** (`۲٫۵` = `2.5`) |
| گروه‌بندی | پرانتز `(` `)` |
| جداکنندهٔ آرگومان | `,` |

### مواردی که خطا می‌دهند

* `t**2` → باید `t^2`
* `v = 2*t` → `=` پشتیبانی نمی‌شود (در `expr` فرمول است، نه معادله)
* نام ناشناخته (`x`, `a`, `g`) ⇒ خطا
* تابع ناشناخته ⇒ خطا
* تقسیم بر صفر ⇒ `Infinity` ⇒ با `NaN` یکسان شمرده می‌شود و آن نقطه از
  مسیر حذف می‌شود (خط شکسته بدون پرش)

### رفتار خطا

`evalExpr(src, t, fallback)` هیچ‌وقت throw نمی‌کند:

| حالت | نتیجه |
| --- | --- |
| فرمول خالی | `fallback` |
| فرمول نامعتبر | `fallback` |
| نتیجهٔ غیرمتناهی | `fallback` |
| فراخوانی تابع با آرگومان غلط | `catch` ⇒ `fallback` |

برای `series` مقدار `fallback` برابر `NaN` است، پس نقطه از مسیر کنار گذاشته
می‌شود؛ برای `layer` مقدار `0` است، پس جسم در مبدأ می‌ماند. یعنی **فرمول
خراب هیچ‌وقت صفحه را نمی‌شکند، ولی بی‌صدا چیزی نشان نمی‌دهد.**

برای بازخورد زنده در استودیو از `check(src)` استفاده می‌شود که
`{ ok, error, at }` برمی‌گرداند — این تنها جایی است که پیام خطای واقعی
کاربر می‌بیند.

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

## ۲۰. حدود و نکات

| حد | مقدار |
| --- | --- |
| سقف عملی `localStorage` | ~۵MB برای همهٔ کلیدها با هم |
| طول عنوان هر کادر | بی‌حد؛ ولی متن بلند یعنی ارائه‌دهنده می‌خواند |
| تعداد کادر در یک بخش | عملی: ۶؛ فراتر از آن در اجرا جا نمی‌شود |
| گزینه‌های پرسش | رابط تا ۸، کلیدها تا ۱۲ (`1`–`6`, `a`–`f`) |
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