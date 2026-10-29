import React from 'react';
import { observer } from 'mobx-react-lite';
import { BEST_STYLES } from '@/best/types';
import { focusRing, STYLE_ICONS, styleName } from '@/best/components/fields';
import { useRaidStore } from '@/raid/state/RaidStore';

/** The styles the raid searches try, as toggle buttons like the best setup page's; at least one stays on */
const StyleToggles: React.FC = observer(() => {
  const store = useRaidStore();
  const { styles } = store.settings;
  return (
    <div className="flex rounded overflow-hidden border border-body-500 dark:border-dark-200" role="group" aria-label="Styles">
      {BEST_STYLES.map((s) => {
        const on = styles.includes(s);
        return (
          <button
            key={s}
            type="button"
            data-style={s}
            className={`flex items-center gap-1 h-8 px-1.5 sm:px-2 text-sm transition-colors ${focusRing} focus-visible:ring-inset ${on
              ? 'bg-orange-400 dark:bg-orange-700 text-white'
              : 'bg-btns-400 dark:bg-dark-500 text-gray-300 hover:bg-btns-300 dark:hover:bg-dark-400'} disabled:cursor-not-allowed`}
            aria-pressed={on}
            disabled={on && styles.length === 1}
            data-tooltip-id="tooltip"
            data-tooltip-content={on && styles.length === 1 ? 'At least one style is searched' : 'Fewer styles search faster'}
            onClick={() => store.setStyles(on ? styles.filter((x) => x !== s) : [...styles, s])}
          >
            <img className={`hidden sm:block w-4 h-4 object-contain ${on ? '' : 'opacity-50 grayscale'}`} src={STYLE_ICONS[s].src} alt="" />
            {styleName(s)}
          </button>
        );
      })}
    </div>
  );
});

export default StyleToggles;
