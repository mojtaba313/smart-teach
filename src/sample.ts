import type { BankQuestion, Presentation, Slide, SlideStep } from './types'
import { SCHEMA_VERSION, uid } from './types'
import { presetById } from './lib/anim/presets'

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

const b = {
  full: 'full',
  half: 'half',
  third: 'third',
} as const

function step(kind: SlideStep['kind'], extra: Record<string, unknown>, span: SlideStep['span'] = b.full): SlideStep {
  return { id: uid('step'), span, kind, ...extra } as SlideStep
}

function text(value: string, span: SlideStep['span'] = b.full): SlideStep {
  return step('text', { value }, span)
}

function list(items: string[], span: SlideStep['span'] = b.full, ordered = false): SlideStep {
  return step('list', { items, ordered }, span)
}

function formula(value: string, span: SlideStep['span'] = b.full): SlideStep {
  return step('formula', { value }, span)
}

function callout(value: string, tone: 'info' | 'tip' | 'warn' | 'idea' = 'info', span: SlideStep['span'] = b.full): SlideStep {
  return step('callout', { value, tone }, span)
}

function trap(value: string, span: SlideStep['span'] = b.full): SlideStep {
  return step('trap', { value }, span)
}

function quiz(question: string, options: string[], answerIndex: number, explanation?: string, span: SlideStep['span'] = b.full): SlideStep {
  return step('quiz', { question, options, answerIndex, explanation }, span)
}

function animation(presetId: string, span: SlideStep['span'] = b.full): SlideStep {
  const preset = presetById(presetId)
  return step('animation', { anim: preset ? preset.build() : undefined }, span)
}

function slide(title: string, steps: SlideStep[], notes?: string): Slide {
  return { id: uid('slide'), title, steps, notes }
}

/* ------------------------------------------------------------------ *
 *  Demo deck — showcases every block, every width, every feature
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  Physics deck
 * ------------------------------------------------------------------ */

export function samplePresentation(): Presentation {
  return {
    schema: SCHEMA_VERSION,
    id: uid('pres'),
    title: 'فیزیک دهم — اندازه‌گیری و حرکت‌شناسی',
    description: 'یک درس کامل با نمودارهای زنده و پرسش‌های کنکور.',
    theme: 'light',
    layout: 'flow',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    slides: [
      slide(
        'مقدمه: چرا اندازه‌گیری؟',
        [
          text(
            'هر چیزی که در فیزیک می‌بینیم، پیش از هر چیز یک **عدد** است و هر عدد یک **دقت**. هدف این درس، فاصله گرفتن از حس و رسیدن به اندازه‌گیری دقیق است.',
            b.full,
          ),
          list(
            [
              '**عدد فیزیکی** = مقدار + یکا',
              'یکا = قرارداد مقایسه با یک مرجع',
              'دقت = نزدیکی نتیجه به مقدار واقعی',
            ],
            b.half,
            true,
          ),
          callout('همیشه یکا را کنار عدد بنویسید. عدد بدون یکا در فیزیک یعنی هیچ.', 'tip', b.half),
        ],
        'با یک پرسش روزمره شروع کنید: «قدرت خود را با چه چیزی مقایسه می‌کنید؟»',
      ),
      slide(
        'دقت و خطای اندازه‌گیری',
        [
          text(
            'دو نوع خطا داریم: **خطای سیستماتیک** (مثل کالیبره نبودن ترازو) و **خطای تصادفی** (مثل نوسان قرائت). اولی با کالیبره برطرف می‌شود، دومی با میانگین‌گیری.',
            b.full,
          ),
          formula('\\bar{x} = \\frac{x_1 + x_2 + \\dots + x_n}{n}', b.half),
          formula('\\Delta x = x_{max} - x_{min}', b.half),
          trap('دقت بیشترِ دستگاه لزوماً به معنی دقت بیشترِ اندازه‌گیری نیست؛ مهارت کاربر هم مهم است.', b.full),
        ],
        'اگر وقت داشتید، گیومتر و کولیس را روی میز بگذارید و دانش‌آموزان خودشان بخوانند.',
      ),
      slide(
        'حرکت‌شناسی: زبان پایه',
        [
          text(
            'برای توصیف حرکت، کافی است بدانیم کجاییم و چقدر سرعت داریم. بقیهٔ کمیت‌ها از همین دو به‌دست می‌آید.',
            b.full,
          ),
          animation('xt', b.full),
          callout('روی نمودار بکشید تا زمان را دستی کنید و شیب را با انگشت دنبال کنید.', 'idea', b.full),
        ],
        'یک نمودار ساده بکشید و شیب را با شیب‌خط توضیح دهید.',
      ),
      slide(
        'حرکت با شتاب ثابت',
        [
          animation('projectile', b.full),
          list(
            [
              'در $v_y$ شیب خط برابر $g$ است، پس خط می‌رود.',
              'در $y$ منحنی سهمی است.',
              'زمان صفر شدن $v_y$ = زمان اوج.',
            ],
            b.half,
            true,
          ),
          callout('سرعت در اوج صفر است اما سرعت افقی صفر **نیست** — همین‌جاست که دانش‌آموزان اشتباه می‌کنند.', 'warn', b.half),
        ],
        'با انیمیشن، مفهوم «سرعت در اوج» را بصری کنید.',
      ),
      slide(
        'نوسان ساده',
        [
          animation('shm', b.full),
          text(
            'دو نمودار $x(t)$ و $v(t)$ در نوسان ساده **۹۰ درجه** اختلاف فاز دارند: وقتی جابه‌جایی بیشینه است، سرعت صفر است.',
            b.full,
          ),
          trap('بیشترین انرژی جنبشی در دو انتهای دامنه نیست؛ در مرکز است.', b.full),
        ],
        'با همین انیمیشن، اشتباه «بیشینهٔ سرعت در دو سر» را زنده اصلاح کنید.',
      ),
      slide(
        'جمع‌بندی و سنجش',
        [
          quiz(
            'شیب نمودار مکان-زمان برابر کدام کمیت است؟',
            ['شتاب', 'سرعت', 'توان', 'جرم'],
            1,
            'شیب نمودار $x$ بر حسب $t$ برابر $\\frac{dx}{dt}$ است، یعنی سرعت.',
          ),
          quiz(
            'در پرتابه، در نقطهٔ اوج کدام گزینه صفر است؟',
            ['سرعت افقی', 'سرعت عمودی', 'شتاب افقی', 'سرعت کل'],
            1,
            'در اوج فقط مؤلفهٔ عمودی سرعت صفر می‌شود؛ سرعت افقی ثابت می‌ماند.',
          ),
          callout('برای مرور سریع، همین انیمیشن‌ها را با کلید `Space` پخش و مکث کنید.', 'tip', b.full),
        ],
        'دو پرسش را با پرش به پرسش‌های کنکوری تکمیل کنید.',
      ),
    ],
  }
}

/* ------------------------------------------------------------------ *
 *  Seed question bank
 * ------------------------------------------------------------------ */

function q(patch: Partial<BankQuestion> & { stem: string; options: string[]; answerIndex: number }): BankQuestion {
  const now = Date.now()
  return {
    id: uid('q'),
    explanation: '',
    tags: [],
    difficulty: 1,
    source: '',
    starred: false,
    createdAt: now,
    updatedAt: now,
    used: 0,
    ...patch,
  }
}

/**
 * A small but representative bank. Every question is addressed by a full
 * hierarchical path such as
 * `کنکور:حرکت شناسی:حرکت شتابدار:نمودار سرعت-زمان`.
 */
export function seedQuestionBank(): BankQuestion[] {
  return [
    q({
      stem: 'نمودار سرعت-زمان یک جسم به‌صورت یک خط مستقیم با شیب $۲ \\ \\mathrm{m/s^2}$ است. اگر سرعت اولیه $۴ \\ \\mathrm{m/s}$ باشد، **سرعت متوسط** در $۳$ ثانیهٔ اول کدام است؟',
      options: ['$۶ \\ \\mathrm{m/s}$', '$۷ \\ \\mathrm{m/s}$', '$۸ \\ \\mathrm{m/s}$', '$۱۰ \\ \\mathrm{m/s}$'],
      answerIndex: 1,
      explanation: 'شیب نمودار برابر شتاب است پس شتاب $۲$. در $۳$ ثانیه سرعت از $۴$ به $۱۰$ می‌رسد، پس سرعت متوسط $(۴+۱۰)/۲ = ۷$.',
      tags: ['کنکور', 'حرکت شناسی', 'حرکت شتابدار', 'نمودار سرعت-زمان'],
      source: 'کنکور ریاضی فیزیک — حرکت‌شناسی',
      year: 1402,
      difficulty: 1,
    }),
    q({
      stem: 'اگر نمودار مکان-زمان یک جسم یک **خط مستقیم** باشد، کدام گزینه درست است؟',
      options: [
        'شتاب ثابت و غیرصفر است',
        'سرعت ثابت است و شتاب صفر',
        'سرعت متغیر است ولی شتاب صفر است',
        'هیچ اطلاعاتی دربارهٔ شتاب نمی‌دهد',
      ],
      answerIndex: 1,
      explanation: 'خط مستقیم یعنی شیب (سرعت) ثابت است؛ ثابت‌بودن سرعت یعنی شتاب صفر.',
      tags: ['کنکور', 'حرکت شناسی', 'حرکت یکنواخت', 'نمودار مکان-زمان'],
      source: 'کنکور ریاضی فیزیک — حرکت‌شناسی',
      year: 1401,
      difficulty: 2,
    }),
    q({
      stem: 'در یک پرتابه با $v_0 = ۲۰ \\ \\mathrm{m/s}$ و $\\theta = ۳۰^\\circ$، سرعت در **نقطهٔ اوج** چقدر است؟ ($g = ۱۰ \\ \\mathrm{m/s^2}$)',
      options: [
        '$۱۰ \\ \\mathrm{m/s}$',
        '$۱۰ \\sqrt{3} \\ \\mathrm{m/s}$',
        '$۲۰ \\ \\mathrm{m/s}$',
        'صفر',
      ],
      answerIndex: 0,
      explanation: 'مؤلفهٔ عمودی در اوج صفر است ولی مؤلفهٔ افقی $v_0\\cos ۳۰ = ۲۰ \\times \\frac{\\sqrt{3}}{۲} = ۱۰\\sqrt{3}$ باقی می‌ماند.',
      tags: ['کنکور', 'حرکت شناسی', 'پرتابه', 'نقطه اوج'],
      source: 'کنکور ریاضی فیزیک — حرکت‌شناسی',
      year: 1400,
      difficulty: 2,
    }),
    q({
      stem: 'در نوسان ساده هماهنگ، اختلاف فاز بین نمودار مکان و نمودار سرعت چقدر است؟',
      options: ['صفر', '$۴۵^\\circ$', '$۹۰^\\circ$', '$۱۸۰^\\circ$'],
      answerIndex: 2,
      explanation: 'چون سرعت مشتق مکان است، منحنی‌ها $۹۰$ درجه اختلاف فاز دارند.',
      tags: ['کنکور', 'نوسان و موج', 'نوسان ساده هماهنگ'],
      source: 'کنکور ریاضی فیزیک — نوسان',
      year: 1403,
      difficulty: 2,
    }),
    q({
      stem: 'میانگین بردارهای سرعت $۴ \\ \\mathrm{m/s}$ روی محور $x$ و $۳ \\ \\mathrm{m/s}$ روی محور $y$ است. اندازهٔ **بردار** سرعت متوسط چقدر است؟',
      options: ['$۱ \\ \\mathrm{m/s}$', '$۳٫۵ \\ \\mathrm{m/s}$', '$۵ \\ \\mathrm{m/s}$', '$۷ \\ \\mathrm{m/s}$'],
      answerIndex: 2,
      explanation: 'بردارها را بردار به بردار جمع می‌کنیم: $\\sqrt{۴^2 + ۳^2} = ۵$. تقسیم کردن هر کدام جداگانه اشتباه است.',
      tags: ['کنکور', 'حرکت شناسی', 'سرعت و تندی'],
      source: 'کنکور ریاضی فیزیک — حرکت‌شناسی',
      year: 1402,
      difficulty: 3,
    }),
    q({
      stem: 'یک جسم روی سطح افقی بدون اصطکاک حرکت می‌کند و نیروی $۳ \\ \\mathrm{N}$ به آن وارد می‌شود؛ جرم $۱ \\ \\mathrm{kg}$ است. شتاب چقدر است؟',
      options: ['$۱ \\ \\mathrm{m/s^2}$', '$۳ \\ \\mathrm{m/s^2}$', '$۹ \\ \\mathrm{m/s^2}$', '$۰٫۳۳ \\ \\mathrm{m/s^2}$'],
      answerIndex: 1,
      explanation: 'از دومین نیوتن $F = ma$ پس $a = F/m = ۳$.',
      tags: ['آزمون', 'دینامیک', 'قانون دوم نیوتن'],
      source: 'آزمون میان‌ترم دهم',
      difficulty: 3,
      starred: true,
    }),
    q({
      stem: 'دو قرص هم‌جرم با سرعت زاویه‌ای یکسان می‌چرخند. کدام گزینه درست است؟',
      options: [
        'قرص بزرگ‌تر تنده‌تر خطی دارد',
        'قرص کوچک‌تر تنده‌تر خطی دارد',
        'هر دو تندهٔ خطی یکسان دارند',
        'تندهٔ خطی به شعاع ربطی ندارد',
      ],
      answerIndex: 0,
      explanation: 'تندهٔ خطی $v = r\\omega$ است؛ با برابر بودن $\\omega$، هرچه شعاع بزرگ‌تر باشد تنده بیشتر است.',
      tags: ['آزمون', 'حرکت دایره‌ای', 'تنده زاویه‌ای'],
      difficulty: 3,
    }),
    q({
      stem: 'دقت اندازه‌گیری $۰٫۱ \\ \\mathrm{cm}$ یعنی بیشترین خطای نسبی چقدر است؟',
      options: ['$۰٫۱$ درصد', '$۱$ درصد', '$۱۰$ درصد', 'بستگی به مقدار خواندن دارد'],
      answerIndex: 3,
      explanation: 'خطای نسبی به مقدار خوانده‌شده بستگی دارد، پس بدون عدد خوانده‌شده نمی‌توان درصد داد.',
      tags: ['آزمون', 'اندازه‌گیری', 'دقت و خطا'],
      difficulty: 4,
      starred: true,
    }),
    q({
      stem: 'اگر شتاب یک جسم $a$ و زمان حرکت $t$ باشد، کدام رابطه **غلط** است؟',
      options: ['$v = at$', '$x = \\tfrac{1}{2}at^2$', '$v^2 = 2ax$', '$t = \\sqrt{ax}$'],
      answerIndex: 3,
      explanation: 'از $x = \\frac12 a t^2$ پس $t = \\sqrt{2x/a}$ به‌دست می‌آید، نه $\\sqrt{ax}$.',
      tags: ['کنکور', 'حرکت شناسی', 'حرکت شتابدار', 'فرمول‌های حرکت'],
      source: 'کنکور ریاضی فیزیک',
      year: 1399,
      difficulty: 4,
    }),
    q({
      stem: 'در $۳ \\ \\mathrm{s}$ نخست یک جسم شتاب‌دار، جابه‌جایی‌اش $۹ \\ \\mathrm{m}$ است. اگر از سکون شروع کرده باشد، شتاب چقدر است؟',
      options: ['$۱ \\ \\mathrm{m/s^2}$', '$۲ \\ \\mathrm{m/s^2}$', '$۳ \\ \\mathrm{m/s^2}$', '$۶ \\ \\mathrm{m/s^2}$'],
      answerIndex: 1,
      explanation: '$x = \\frac12 a t^2$ پس $۹ = \\frac12 a \\times ۹$ و $a = ۲$.',
      tags: ['کنکور', 'حرکت شناسی', 'حرکت شتابدار', 'فرمول‌های حرکت'],
      source: 'کنکور ریاضی فیزیک',
      year: 1398,
      difficulty: 5,
    }),
  ]
}
