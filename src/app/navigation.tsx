import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from './theme';
import { useI18n } from './i18n';
import { useAppStore } from './store/appStore';
import type { RootStackParamList, TabParamList } from './navigationTypes';

import DashboardScreen from './screens/DashboardScreen';
import PosScreen from './screens/PosScreen';
import ProductsScreen from './screens/ProductsScreen';
import MoreScreen from './screens/MoreScreen';
import ProductFormScreen from './screens/ProductFormScreen';
import ProductDetailScreen from './screens/ProductDetailScreen';
import SaleDetailScreen from './screens/SaleDetailScreen';
import SalesScreen from './screens/SalesScreen';
import PurchasesScreen from './screens/PurchasesScreen';
import PurchaseFormScreen from './screens/PurchaseFormScreen';
import PurchaseDetailScreen from './screens/PurchaseDetailScreen';
import PartyListScreen from './screens/PartyListScreen';
import PartyFormScreen from './screens/PartyFormScreen';
import PartyDetailScreen from './screens/PartyDetailScreen';
import AdjustmentsScreen from './screens/AdjustmentsScreen';
import AdjustmentFormScreen from './screens/AdjustmentFormScreen';
import RestockScreen from './screens/RestockScreen';
import ExpensesScreen from './screens/ExpensesScreen';
import CashClosingScreen from './screens/CashClosingScreen';
import ReportsScreen from './screens/ReportsScreen';
import ReportViewScreen from './screens/ReportViewScreen';
import ReturnsScreen from './screens/ReturnsScreen';
import SettingsScreen from './screens/SettingsScreen';
import SecurityScreen from './screens/SecurityScreen';
import BackupScreen from './screens/BackupScreen';
import HelpScreen from './screens/HelpScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={[styles.tabIcon, focused && { color: colors.primary }]}>{glyph}</Text>;
}

const tabIcons = {
  dashboard: ({ focused }: { focused: boolean }) => <TabIcon glyph="⌂" focused={focused} />,
  pos: ({ focused }: { focused: boolean }) => <TabIcon glyph="🛒" focused={focused} />,
  products: ({ focused }: { focused: boolean }) => <TabIcon glyph="▤" focused={focused} />,
  more: ({ focused }: { focused: boolean }) => <TabIcon glyph="☰" focused={focused} />,
};

function Tabs() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontSize: font.md, fontWeight: '800', color: colors.text },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        // Grow with the system navigation area so labels are never clipped by
        // gesture nav or the three-button bar.
        tabBarStyle: {
          height: 56 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 6),
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontSize: font.xs, fontWeight: '700' },
      }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: t('dashboard'),
          tabBarIcon: tabIcons.dashboard,
        }}
      />
      <Tab.Screen
        name="Pos"
        component={PosScreen}
        options={{
          title: t('pos'),
          headerShown: false,
          tabBarIcon: tabIcons.pos,
        }}
      />
      <Tab.Screen
        name="Products"
        component={ProductsScreen}
        options={{
          title: t('products'),
          tabBarIcon: tabIcons.products,
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{
          title: t('more'),
          tabBarIcon: tabIcons.more,
        }}
      />
    </Tab.Navigator>
  );
}

export default function Navigation() {
  const { t } = useI18n();
  const noteActivity = useAppStore(s => s.noteActivity);

  return (
    <NavigationContainer
      onStateChange={() => noteActivity()}
      theme={{
        dark: false,
        colors: {
          primary: colors.primary,
          background: colors.bg,
          card: colors.card,
          text: colors.text,
          border: colors.border,
          notification: colors.primary,
        },
        fonts: {
          regular: { fontFamily: 'sans-serif', fontWeight: '400' },
          medium: { fontFamily: 'sans-serif-medium', fontWeight: '500' },
          bold: { fontFamily: 'sans-serif', fontWeight: '700' },
          heavy: { fontFamily: 'sans-serif', fontWeight: '800' },
        },
      }}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTitleStyle: { fontSize: font.md, fontWeight: '800', color: colors.text },
          headerTintColor: colors.primary,
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="ProductForm" component={ProductFormScreen} options={{ title: t('addProduct') }} />
        <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: t('products') }} />
        <Stack.Screen name="SaleDetail" component={SaleDetailScreen} options={{ title: t('receipt') }} />
        <Stack.Screen name="SalesHistory" component={SalesScreen} options={{ title: t('recentSales') }} />
        <Stack.Screen name="PurchaseForm" component={PurchaseFormScreen} options={{ title: t('newPurchase') }} />
        <Stack.Screen name="PurchaseDetail" component={PurchaseDetailScreen} options={{ title: t('purchases') }} />
        <Stack.Screen name="PurchasesHistory" component={PurchasesScreen} options={{ title: t('purchases') }} />
        <Stack.Screen name="PartyList" component={PartyListScreen} options={{ title: t('khata') }} />
        <Stack.Screen name="PartyForm" component={PartyFormScreen} options={{ title: t('add') }} />
        <Stack.Screen name="PartyDetail" component={PartyDetailScreen} options={{ title: t('khata') }} />
        <Stack.Screen name="StockAdjustments" component={AdjustmentsScreen} options={{ title: t('stockAdjust') }} />
        <Stack.Screen name="AdjustmentForm" component={AdjustmentFormScreen} options={{ title: t('stockAdjust') }} />
        <Stack.Screen name="Restock" component={RestockScreen} options={{ title: t('restock') }} />
        <Stack.Screen name="Expenses" component={ExpensesScreen} options={{ title: t('expenses') }} />
        <Stack.Screen name="CashClosing" component={CashClosingScreen} options={{ title: t('cashClosing') }} />
        <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: t('reports') }} />
        <Stack.Screen name="ReportView" component={ReportViewScreen} options={{ title: t('report') }} />
        <Stack.Screen name="Returns" component={ReturnsScreen} options={{ title: t('returns') }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: t('settings') }} />
        <Stack.Screen name="Security" component={SecurityScreen} options={{ title: t('security') }} />
        <Stack.Screen name="Backup" component={BackupScreen} options={{ title: t('backup') }} />
        <Stack.Screen name="Help" component={HelpScreen} options={{ title: t('help') }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabIcon: { fontSize: 18, color: colors.muted },
});
