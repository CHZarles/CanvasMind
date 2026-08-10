import { computed, unref, type MaybeRef } from 'vue'
import { useSystemSettingsStore } from '@/stores/system-settings'
import type { SystemHomeSideMenuSettingsConfig } from '@/api/system-config'

const CREATION_ENTRY_KEYS = new Set(['generate', 'canvas', 'workflow'])

export const useHomeSideMenuConfig = (options?: {
  settingsOverride?: MaybeRef<SystemHomeSideMenuSettingsConfig | null | undefined>
  includeHidden?: boolean
}) => {
  const { publicSystemSettings } = useSystemSettingsStore()

  const sideMenuSettings = computed(() => {
    return unref(options?.settingsOverride) || publicSystemSettings.value.homeSideMenuSettings
  })

  const sortedItems = computed(() => {
    return [...(sideMenuSettings.value.items || [])].sort((left, right) => left.sortOrder - right.sortOrder)
  })

  const shouldIncludeItem = (visible?: boolean) => {
    if (options?.includeHidden) {
      return true
    }
    return visible
  }

  const topItems = computed(() => sortedItems.value.filter(item => item.section === 'top' && shouldIncludeItem(item.visible)))
  const centerItems = computed(() => {
    const items = sortedItems.value.filter(item => (
      item.section === 'center' && item.key !== 'publish' && shouldIncludeItem(item.visible)
    ))
    const creationEntry = items.find(item => CREATION_ENTRY_KEYS.has(item.key))
    if (!creationEntry) return items

    return items.flatMap(item => {
      if (!CREATION_ENTRY_KEYS.has(item.key)) return [item]
      if (item !== creationEntry) return []
      return [{
        ...item,
        key: 'workflow',
        title: '创作',
        icon: 'workflow',
        actionType: 'route',
        actionValue: '/workflow',
      }]
    })
  })
  const bottomItems = computed(() => sortedItems.value.filter(item => (
    item.section === 'bottom' && item.key !== 'marketing' && shouldIncludeItem(item.visible)
  )))
  const layoutMode = computed(() => sideMenuSettings.value.layoutMode === 'top' ? 'top' : 'side')

  const sideMenuStyleVars = computed(() => {
    const settings = sideMenuSettings.value
    const width = settings.enabled === false || layoutMode.value === 'top' ? 0 : settings.collapsedWidth

    return {
      '--side-menu-width': `${width}px`,
      '--side-drawer-width': `${settings.drawerWidth}px`,
      '--side-drawer-float-limit-width': `${settings.drawerFloatLimitWidth}px`,
    }
  })

  return {
    sideMenuSettings,
    layoutMode,
    topItems,
    centerItems,
    bottomItems,
    sideMenuStyleVars,
  }
}
