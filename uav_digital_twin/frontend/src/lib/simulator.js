// In-browser copy of sensor_simulator.py, used by the "Simulated" source so the
// dashboard can be developed and demoed without the backend running.
// Same base values, noise and fault odds as the Python script.

const BASE = {
  rpm: 2800,
  cht: 185,
  egt: 720,
  oil_pressure: 45,
  oil_temperature: 90,
  fuel_flow: 12,
  vibration: 0.3,
  battery_voltage: 24.5,
  alternator_current: 8,
  injection_timing: 12,
}

const uniform = (a, b) => a + Math.random() * (b - a)

export function simulateReading() {
  const v = {
    rpm: BASE.rpm + uniform(-50, 50),
    cht: BASE.cht + uniform(-2, 2),
    egt: BASE.egt + uniform(-10, 10),
    oil_pressure: BASE.oil_pressure + uniform(-2, 2),
    oil_temperature: BASE.oil_temperature + uniform(-2, 2),
    fuel_flow: BASE.fuel_flow + uniform(-0.5, 0.5),
    vibration: BASE.vibration + uniform(-0.05, 0.05),
    battery_voltage: BASE.battery_voltage + uniform(-0.3, 0.3),
    alternator_current: BASE.alternator_current + uniform(-0.5, 0.5),
    injection_timing: BASE.injection_timing + uniform(-0.5, 0.5),
  }

  const faultChance = Math.floor(Math.random() * 100) + 1

  if (faultChance <= 4) {
    // OVERHEATING
    v.cht += uniform(30, 40)
    v.egt += uniform(100, 140)
    v.oil_temperature += uniform(15, 25)
  } else if (faultChance <= 7) {
    // MISFIRE
    v.rpm -= uniform(300, 600)
    v.vibration += uniform(0.5, 1.0)
    v.egt -= uniform(80, 150)
  } else if (faultChance <= 10) {
    // LOW_OIL_PRESSURE
    v.oil_pressure -= uniform(15, 25)
    v.oil_temperature += uniform(8, 15)
    v.vibration += uniform(0.05, 0.2)
  } else if (faultChance <= 12) {
    // HIGH_VIBRATION
    v.vibration += uniform(0.7, 1.2)
    v.rpm += uniform(-150, 150)
  } else if (faultChance <= 14) {
    // FUEL_ANOMALY
    v.fuel_flow += uniform(3, 5)
    v.rpm -= uniform(150, 350)
    v.egt += uniform(-70, 70)
  } else if (faultChance <= 15) {
    // ELECTRICAL_FAULT
    v.battery_voltage -= uniform(2, 4)
    v.alternator_current -= uniform(3, 5)
  }

  return { engine_id: 'SIMULATED', timestamp: new Date().toISOString(), ...v }
}
