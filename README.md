# usage-bar

Una mod per Claude Code che mostra i consumi nella riga sotto al riquadro dove scrivi, accanto all'indicatore
della modalità (`⏵⏵ auto mode on`). Prende il posto del suggerimento fisso «(shift+tab to cycle) · ← for agents»,
quindi non occupa una riga in più come una status line.

```
⏵⏵ auto mode on · ctx ━━────────  13%  │  5h ━│━───────  16%  ↺ 16:50 · 4h32m  ▲ finisce ~14:40  │  7g ━━━──────│  25%  ↺ dom 07:00  ✓ −64
```

- **ctx**: quanto è pieno il contesto (blu, poi giallo da 50%, rosso da 75%).
- **5h / 7g**: limite di 5 ore e limite settimanale. Il pieno è quanto hai usato; la tacca chiara `│` è dove saresti
  andando a ritmo costante (tempo passato / durata della finestra). Se il pieno supera la tacca, stai consumando troppo in fretta.
- **↺**: quando il limite si azzera (per le 5 ore anche quanto manca).
- **Ritmo**: `✓ in linea`, `✓ −30` (30 punti sotto il ritmo), `▲ finisce ~gio 18:00` (sopra il ritmo: andando avanti con
  la media fin qui lo esaurisci a quell'ora, prima del reset), `✕ esaurito`.

Si adatta alla larghezza del terminale (dalla versione completa a una compatta senza barre). Gli avvisi di Claude Code
che usano quella riga (per esempio «Press Ctrl-C again to exit») restano visibili.

`/bar` spegne e riaccende la barra; la scelta vale anche per le sessioni nuove.

Note: i limiti a 5 ore e settimanali ci sono solo con un abbonamento Claude (Pro/Max). Le ore sono nel fuso
del computer (quello di sistema, o `TZ` se è impostata). La larghezza del terminale arriva alla mod solo con l'interfaccia a schermo intero (`"tui": "fullscreen"`);
senza, la barra usa 120 colonne e taglia la fine se non c'entra.

## Installazione

Al prompt di una sessione di Claude Code nel terminale:

```
/plugin install usage-bar --marketplace rizzutomatteo/claude-usage-bar
```

Rispondi `y` ad «Add marketplace?», poi scegli lo scope (user, il primo, con Invio).

Da una shell:

```
claude plugin install usage-bar --marketplace rizzutomatteo/claude-usage-bar
```

Nell'app desktop, dove `/plugin` non funziona: clicca + accanto al riquadro del prompt, poi Plugins, Add marketplace con
`rizzutomatteo/claude-usage-bar`, poi Add plugin.
