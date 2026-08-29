import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#31473f',
          colorText: '#8fa198',
          colorTextSecondary: '#58675f',
          colorBgContainer: '#0b110f',
          colorBgElevated: '#0c1310',
          colorBorder: '#26352e',
          fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          borderRadius: 24,
          controlHeight: 48,
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
