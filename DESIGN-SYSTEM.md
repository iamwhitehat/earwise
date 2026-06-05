# Earwise — Design System

*Razširja `BRAND.md` (identiteta) v produktni UI sistem za redesign (`REDESIGN-SPEC.md`). **Identiteta se ne spreminja:** ime earwise, signal-burst mark, lime-on-near-black, Geist ostanejo. Tukaj definiramo, kako ta jezik živi v novih vzorcih (triage, drawer, ⌘K, journey, funnel).*

## Kaj se je prilagodilo (4 stvari)

1. **Lime-rule prečiščen za gosti UI** — prej "en lime na zaslon"; v triage inboxu je lime = *naslednja poteza / najbolj vroče*, **ena na decision-unit** (kartico), ne na cel zaslon. Lime nikoli kot dekor/obroba povsod.
2. **Razširjen semantični barvni sistem** — brand pokrije identiteto, ne pa novih stanj: status pipeline, heat/tiers (hot/warm/cold), direction, funnel/leak.
3. **Density modes + data-dense tipografija** — comfortable (privzeto, nov uporabnik) / compact (power); tabular figures za score, %, funnel.
4. **Component library** za nove vzorce + motion + a11y.

Plus implementacijska opomba: lime trenutno živi v `app/earwise-theme.css`, `app/globals.css` ima še stari modri `--accent` → **poenoti tokene** (en vir resnice).

---

## Načela (UI)

- **Lime = naslednja poteza ali najbolj vroč element.** Ena primarna (lime) akcija na decision-unit; v listu lime označi fokusirani/najbolj vroč element. Vse ostalo nevtralno.
- **Amber = vrednost & pozornost.** Advantage score, "win" trenutki, funnel-leak warning. (Gold, redko.)
- **Dark-first, calm-but-fast.** Vsebina prva, malo chrome-a, vidni keyboard-hinti, instant optimistic UI.
- **Nevtralno nosi 90 %.** Base/surface/line/ink/muted nosijo strukturo; barva samo, ko nosi pomen.

---

## Barvni sistem (razširjen)

**Core (iz brand-a):**

| Token | Hex | Vloga |
|---|---|---|
| `--base` | `#0E0F13` | dark canvas |
| `--surface` | `#17191E` | kartice / paneli |
| `--line` | `#262A31` | obrobe / delilniki |
| `--ink` | `#ECEFE8` | besedilo (dark) |
| `--muted` | `#9AA0A6` | sekundarno besedilo |
| `--signal` (lime) | `#B6FF3C` | naslednja poteza, accent, mark |
| `--signal-dim` | `#9BE22A` | hover / sekundarni |
| `--on-signal` | `#0E0F13` | besedilo na lime polnilu |
| `--advantage` (amber) | `#FFC53D` | score / win / leak-warning |

**Status pipeline** (lead board) — chip ostane nevtralen (`--surface`), **status nosi pika**, da lime ne preplavi:

| Status | Dot | Pomen |
|---|---|---|
| new | `#8A93A0` | nov |
| contacted | `#C9A227` | kontaktiran |
| replied | `#9BE22A` | odgovoril |
| call | `#B6FF3C` | klic |
| customer | `#B6FF3C` (filled chip + lime border) | stranka = win |
| passed | `#5A5F66` (dim, strikethrough) | opuščen |

**Heat / tiers** (hot-now, lead score):

| Tier | Barva | Kdaj |
|---|---|---|
| hot 🔥 | `#B6FF3C` | willing-to-pay / sveže / ICP match |
| warm | `#FFC53D` | srednji namen |
| cold | `#8A93A0` | šibko / star |

Lead Score badge (0–100) obarvan po tieru.

**Direction** (trendi): accelerating `#B6FF3C` · rising `#9BE22A` · stable `#8A93A0` · declining `#FF5C73`.
**Funnel / leak:** stopnje nevtralne (`--surface`), conversion % `--muted`, **leak** = amber `#FFC53D` (severe = `#FF5C73`).

Light theme: ista semantika, lime postane `--signal-deep #3A6710` za *besedilo* (kontrast), polnila ostanejo lime; base→paper `#F7F8F4`.

---

## Tipografija & density

- **Geist** (sans) + **Geist Mono**. Wordmark 700. UI 400/500. **Tabular figures** za vse številke (score, %, funnel, števci) — `font-variant-numeric: tabular-nums`.
- **Mono za podatke** — score, Lead Score, conversion %, časi ("18m ago"), kratice subov.
- **Density modes:** `comfortable` (privzeto — row ~44px, vec zraka) za novega; `compact` (row ~32px, gostejše) za power. Toggle `⌥d`; persisted. Definiraj dva spacing-scala (`--space-*`), ne ad-hoc px.

---

## Component library (novi vzorci)

**Decision card** (Today triage) — `--surface`, `--line` obroba, radius-lg. Anatomija: type-label (11px `--muted`) · naslov (14px `--ink`) · 1-vrstični dokaz (`--muted`) · score (amber, če opp) · **primarna lime akcija** + ghost sekundarna + keyboard-hint chip + `ⓘ why`. States: default / focused (lime levi rob 2px) / acting (slide-out + undo toast) / snoozed (dim).

**Right drawer** — slide-in z desne (240–420px), `--surface`, leva `--line` obroba. Stackable (drill); header (naslov + close `✕`/Esc) + telo + sticky akcije spodaj. Brez `position:fixed` težav — overlay scrim `rgba(0,0,0,.45)`.

**Command palette (⌘K)** — centriran overlay, `--surface`, scrim. Vrstice: ikona + label + `↵` na fokusirani (lime besedilo/levi rob). Načini Go/Act/Ask (`Tab`), trenutni način kot pill.

**Journey stepper** — vodoravni: done (`--muted` + ✓), **current (lime besedilo + lime podčrt)**, upcoming (dim). Klik stopnje = skok na njen tab/akcijo.

**Hot-now card + heat badge** — kot decision card + `🔥 Lead Score` (tier barva) + recency ("18m ago", lime če < 1h) + `[Reply now]` (lime).

**Lead card** — oseba · excerpt (matched phrase `<mark>` v `--signal` na temnem = lime highlight z `--on-signal` besedilom) · source `↗` · status chip (zgoraj) · opener akcije · starost.

**Status pill** — nevtralen chip + status-dot (gl. tabelo). `customer` = filled lime + `--on-signal`.

**Conversion funnel** — vodoravne stopnje z %; leak-stopnja amber poudarek + `[help]`; per-channel mini breakdown spodaj.

**Score gauge / advantage badge** — amber številka; klik → breakdown popover (demand/monetization/momentum/whitespace/fit kot mini bari).

**Keyboard-hint chip** — `--line` obroba, mono 11px `--muted` (`e` `s` `x`). Overlay `?` = polna mapa.

**Empty state** — ikona (`--muted`) + 1 stavek kaj je + **ena lime akcija**. Nikoli prazna stran.

**Toast / undo** — spodaj, `--surface`, `Undo` (lime tekst). Coachmark — max 1 naenkrat, dismissable, ne blokira.

---

## Motion & feedback

Hitro in subtilno: triage poteza = card slide-out 150ms + undo toast; drawer slide 200ms; optimistic UI (akcija takoj, sync v ozadju). Brez bouncy/dekorativnih animacij. **Spoštuj `prefers-reduced-motion`** (že implementirano) — izklopi translate/animacije, ohrani končna stanja.

## Accessibility

- **Lime nikoli kot body-text na temnem** (slab kontrast) — lime za polnila/akcente/marke; besedilo `--ink`/`--muted`. Lime polnilo → `--on-signal` (near-black) besedilo.
- Vse številke/score imajo tudi besedilni pomen (ne le barva tiera) — barva + label + ikona.
- Vidni `:focus-visible` (že shipano) — kritično za keyboard-first; `?` shortcut overlay.
- AA kontrast na obeh temah; funnel/heat ne sme biti samo barva (dodaj label/%).

---

## Mapping na zaslone

- **Today** = decision cards + Hot-now card + heat badge + keyboard-hint chips + toasts.
- **Opportunity workspace** = journey stepper + score gauge/advantage + interni tabi + drawer (evidence).
- **Pipeline** = lead cards + status pills + drawer (conversation) + (Reach) channel-density bars.
- **Convert** = funnel + leak warning + hot-now + lead-score tiers.
- **Povsod** = ⌘K palette, density toggle, empty states, undo toasts.

## Implementacija

Token-driven: **poenoti** barve v `app/globals.css` (zamenjaj stari modri `--accent` z `--signal` setom) ali jasno pusti `app/earwise-theme.css` kot edini override in počisti podvojene modre tokene. Dodaj nove semantične tokene (status/heat/direction/funnel) + dva spacing-scala (density). Komponente kot razredi (ne inline), da je dark/light + density centralno.
