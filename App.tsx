import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TelegramPocScreen } from './src/screens/TelegramPocScreen';

function App() {
  return (
    <SafeAreaProvider>
      <TelegramPocScreen />
    </SafeAreaProvider>
  );
}

export default App;
