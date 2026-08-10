<template>
  <FrontstagePageShell main-container-id="dreamina-ui-configuration-content-wrapper">
    <div class="scroll-container-Jsws2j scroll-container-QnV2C9">
      <div>
        <div class="scroll-content-DaYLnh scroll-content">
          <div class="home-content-shell">
            <div class="section-generator">
              <!-- 首页头部 -->
              <HomeHeader/>
            </div>

          </div>
        </div>
      </div>
    </div>
  </FrontstagePageShell>
</template>

<script setup>
import FrontstagePageShell from '@/components/layout/FrontstagePageShell.vue'
import HomeHeader from '../../components/home/components/HomeHeader.vue'
</script>

<style scoped>
.home-content-shell {
/*  width: min(100%, 1680px);
  margin: 0 auto;*/
  box-sizing: border-box;
  padding-inline: 10px;
}

@media (min-width: 1280px) {
  .home-content-shell {
    padding-inline: 10px;
  }
}

</style>
