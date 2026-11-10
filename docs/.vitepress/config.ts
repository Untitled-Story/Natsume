import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Natsume',
  description: '基于 PixiJS 与 WebGL2 的 Unity 特效 Web 运行库',
  lang: 'zh-CN',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [{ text: '指南', link: '/guide/introduction' }],
    sidebar: {
      '/guide/': [{ text: '开始', items: [{ text: '简介', link: '/guide/introduction' }] }],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Untitled-Story/Natsume' }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到相关结果',
            resetButtonTitle: '清除查询',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    outline: { label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    footer: { message: '基于 Apache License 2.0 发布', copyright: 'Natsume' },
  },
});
