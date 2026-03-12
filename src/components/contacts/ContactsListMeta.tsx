type AvatarEnrichProgress = {
  loaded: number
  total: number
  running: boolean
}

type ContactsListMetaProps = {
  filteredCount: number
  totalCount: number
  contactsUpdatedAt: number | null
  contactsUpdatedAtLabel: string
  contactsDataSource: 'cache' | 'network' | null
  avatarCachedCount: number
  avatarCacheUpdatedAtLabel: string
  isLoading: boolean
  avatarEnrichProgress: AvatarEnrichProgress
  exportMode: boolean
  allFilteredSelected: boolean
  selectedCount: number
  selectedInFilteredCount: number
  onToggleAllFiltered: (checked: boolean) => void
}

export function ContactsListMeta({
  filteredCount,
  totalCount,
  contactsUpdatedAt,
  contactsUpdatedAtLabel,
  contactsDataSource,
  avatarCachedCount,
  avatarCacheUpdatedAtLabel,
  isLoading,
  avatarEnrichProgress,
  exportMode,
  allFilteredSelected,
  selectedCount,
  selectedInFilteredCount,
  onToggleAllFiltered
}: ContactsListMetaProps) {
  return (
    <>
      <div className="contacts-count">
        共 {filteredCount} / {totalCount} 个联系人
        {contactsUpdatedAt && (
          <span className="contacts-cache-meta">
            {contactsDataSource === 'cache' ? '缓存' : '最新'} · 更新于 {contactsUpdatedAtLabel}
          </span>
        )}
        {totalCount > 0 && (
          <span className="contacts-cache-meta">
            头像缓存 {avatarCachedCount}/{totalCount}
            {avatarCacheUpdatedAtLabel ? ` · 更新于 ${avatarCacheUpdatedAtLabel}` : ''}
          </span>
        )}
        {isLoading && totalCount > 0 && (
          <span className="contacts-cache-meta syncing">后台同步中...</span>
        )}
        {avatarEnrichProgress.running && (
          <span className="avatar-enrich-progress">
            头像补全中 {avatarEnrichProgress.loaded}/{avatarEnrichProgress.total}
          </span>
        )}
      </div>

      {exportMode && (
        <div className="selection-toolbar">
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={(event) => onToggleAllFiltered(event.target.checked)}
              disabled={filteredCount === 0}
            />
            <span>全选当前筛选结果</span>
          </label>
          <span className="selection-count">已选 {selectedCount}（当前筛选 {selectedInFilteredCount} / {filteredCount}）</span>
        </div>
      )}
    </>
  )
}
