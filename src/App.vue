<template>
  <ElConfigProvider :locale="zhCn" size="default" :z-index="30000">
    <div id="app">
      <RouteProgressBar />
      <router-view />
      <ThemeToggle />
      <LoginModal
        :visible="loginModalVisible"
        @update:visible="setLoginModalVisible"
      />
      <GlobalLoadingOverlay />
    </div>
  </ElConfigProvider>
</template>

<script setup lang="ts">
import { defineAsyncComponent, watch } from 'vue'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useRoute, useRouter } from 'vue-router'
import ThemeToggle from '@/components/ThemeToggle.vue'
import RouteProgressBar from '@/components/common/RouteProgressBar.vue'
import GlobalLoadingOverlay from '@/components/common/GlobalLoadingOverlay.vue'
import { useAuthStore } from '@/stores/auth'
import { useLoginModalStore } from '@/stores/login-modal'

const LoginModal = defineAsyncComponent(() => import('@/components/LoginModal.vue'))
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { loginModalVisible, openLoginModal, setLoginModalVisible } = useLoginModalStore()

void authStore.loadSession()

watch(() => route.query.login, (loginFlag) => {
  if (loginFlag !== '1' || authStore.isLoggedIn.value) return
  openLoginModal('route-guard')
  void router.replace({
    path: route.path,
    query: { ...route.query, login: undefined },
  })
}, { immediate: true })
</script>
