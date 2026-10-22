import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MainApp } from './src/app/MainApp';

function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

export default App;
