<template>
  <FrontstagePageShell layout="raw">
    <main class="account-profile-page">
      <section class="account-profile" aria-labelledby="account-profile-name">
        <img
          :src="profileAvatar"
          class="account-profile__avatar"
          :alt="displayName"
        >
        <div class="account-profile__identity">
          <h1 id="account-profile-name">{{ displayName }}</h1>
          <p>{{ profileIdentifier }}</p>
        </div>
        <button
          class="account-profile__logout"
          type="button"
          :disabled="isLoggingOut"
          @click="handleLogout"
        >
          {{ isLoggingOut ? '退出中...' : '退出登录' }}
        </button>
      </section>
    </main>
  </FrontstagePageShell>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import FrontstagePageShell from '@/components/layout/FrontstagePageShell.vue'
import { useAuthStore } from '@/stores/auth'

const emptyAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='100' fill='%23E5E7EB'/%3E%3Ccircle cx='100' cy='76' r='30' fill='%239CA3AF'/%3E%3Cpath d='M52 154c8-24 28-38 48-38s40 14 48 38' fill='%239CA3AF'/%3E%3C/svg%3E"
const authStore = useAuthStore()
const router = useRouter()
const isLoggingOut = ref(false)

const profileAvatar = computed(() => authStore.currentUser.value?.avatarUrl || emptyAvatar)
const displayName = computed(() => authStore.currentUser.value?.name || '登录用户')
const profileIdentifier = computed(() => (
  authStore.currentUser.value?.email
  || authStore.currentUser.value?.phone
  || authStore.currentUser.value?.maskedEmail
  || authStore.currentUser.value?.maskedPhone
  || ''
))

const handleLogout = async () => {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  try {
    await authStore.logout()
    ElMessage.success('已退出登录')
    await router.replace('/')
  } finally {
    isLoggingOut.value = false
  }
}

watch(
  [authStore.isLoggedIn, authStore.sessionInitialized, authStore.sessionLoading],
  ([loggedIn, initialized, loading]) => {
    if (!loggedIn && initialized && !loading) {
      void router.replace({ path: '/', query: { login: '1' } })
    }
  },
)
</script>

<style scoped>
.account-profile-page {
  min-height: 100vh;
  padding: 64px clamp(24px, 6vw, 96px);
  background: var(--theme-page-background, #0f0f12);
  color: var(--text-primary);
}

.account-profile {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  max-width: 960px;
  margin: 0 auto;
  padding-bottom: 32px;
  border-bottom: 1px solid var(--stroke-primary);
}

.account-profile__avatar {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  object-fit: cover;
}

.account-profile__identity h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.3;
  letter-spacing: 0;
}

.account-profile__identity p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.account-profile__logout {
  min-height: 36px;
  padding: 0 16px;
  border: 1px solid var(--stroke-primary);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.account-profile__logout:disabled {
  cursor: default;
  opacity: 0.5;
}

@media (max-width: 640px) {
  .account-profile {
    grid-template-columns: 64px minmax(0, 1fr);
  }

  .account-profile__avatar {
    width: 64px;
    height: 64px;
  }

  .account-profile__logout {
    grid-column: 1 / -1;
    justify-self: start;
  }
}
</style>
