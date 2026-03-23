import type { ThemeMode, ViewMode, ProcessType } from '@shared/types';

interface HeaderProps {
  search: string;
  onSearchChange: (value: string) => void;
  activeTag: string | null;
  onClearTag: () => void;
  typeFilter: ProcessType | 'all';
  onTypeFilterChange: (value: ProcessType | 'all') => void;
  viewMode: ViewMode;
  onViewModeChange: (value: ViewMode) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  hiddenCount: number;
  showHidden: boolean;
  onToggleHidden: () => void;
  systemCount: number;
  showSystem: boolean;
  onToggleSystem: () => void;
}

const FILTERS: Array<{ label: string; value: ProcessType | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Web', value: 'web' },
  { label: 'API', value: 'api' },
  { label: 'DB', value: 'database' },
  { label: 'System', value: 'system' },
  { label: 'Other', value: 'other' },
];

export function Header({
  search,
  onSearchChange,
  activeTag,
  onClearTag,
  typeFilter,
  onTypeFilterChange,
  viewMode,
  onViewModeChange,
  theme,
  onToggleTheme,
  onOpenSettings,
  hiddenCount,
  showHidden,
  onToggleHidden,
  systemCount,
  showSystem,
  onToggleSystem,
}: HeaderProps): JSX.Element {
  return (
    <header className="panel header-bar">
      <div className="wordmark">
        <img
          alt=""
          aria-hidden="true"
          className="wordmark-logo"
          src="/logo.png"
        />
        <div className="wordmark-copy">
          <h1>portctl</h1>
          <p>Watch, move, and reserve local ports without memorizing lsof.</p>
        </div>
      </div>

      <div className="search-stack">
        <div className="search-row">
          <input
            className="search-input"
            placeholder="Search by process, port, tag, or command"
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
          />
        </div>

        <div className="filter-row">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              className={typeFilter === filter.value ? 'chip-active' : 'chip'}
              onClick={() => {
                onTypeFilterChange(filter.value);
              }}
              type="button"
            >
              {filter.label}
            </button>
          ))}
          {activeTag ? (
            <button className="chip-active" onClick={onClearTag} type="button">
              tag:{activeTag}
            </button>
          ) : null}
        </div>
      </div>

      <div className="header-actions">
        <div className="segmented">
          <button
            className={viewMode === 'card' ? 'active' : ''}
            onClick={() => {
              onViewModeChange('card');
            }}
            type="button"
          >
            Cards
          </button>
          <button
            className={viewMode === 'table' ? 'active' : ''}
            onClick={() => {
              onViewModeChange('table');
            }}
            type="button"
          >
            Table
          </button>
        </div>

        <button className={showSystem ? 'chip-active' : 'chip'} onClick={onToggleSystem} type="button">
          Sys {systemCount > 0 ? `(${systemCount})` : ''}
        </button>
        <button className={showHidden ? 'chip-active' : 'chip'} onClick={onToggleHidden} type="button">
          Hidden {hiddenCount > 0 ? `(${hiddenCount})` : ''}
        </button>
        <button className="icon-button" onClick={onToggleTheme} type="button">
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button className="icon-button" onClick={onOpenSettings} type="button">
          Settings
        </button>
      </div>
    </header>
  );
}
