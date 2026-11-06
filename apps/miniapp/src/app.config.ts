export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/discover/index',
    'pages/about/index',
    'pages/search/index',
    'pages/detail/index',
  ],
  window: {
    navigationBarTitleText: 'AI DAILY',
    navigationBarBackgroundColor: '#f7f8f2',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f7f8f2',
    backgroundTextStyle: 'dark',
  },
  tabBar: {
    color: '#899480',
    selectedColor: '#294d37',
    backgroundColor: '#fbfcf8',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '日报',
        iconPath: 'assets/tab-home.png',
        selectedIconPath: 'assets/tab-home-active.png',
      },
      {
        pagePath: 'pages/discover/index',
        text: '发现',
        iconPath: 'assets/tab-discover.png',
        selectedIconPath: 'assets/tab-discover-active.png',
      },
      {
        pagePath: 'pages/about/index',
        text: '关于',
        iconPath: 'assets/tab-about.png',
        selectedIconPath: 'assets/tab-about-active.png',
      },
    ],
  },
  lazyCodeLoading: 'requiredComponents',
});
