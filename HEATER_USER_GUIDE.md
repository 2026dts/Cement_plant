# Standard Operating Procedure (SOP): Heater Control

## 1. Purpose and scope

This SOP describes how to check and operate the kiln heater (`klin_heater`) and the separate preheating tower heater (`preheating_tower_heater`) from the plant dashboard or Cupola widget. It also describes kiln automatic control and how to return the kiln controls to automatic mode.

## 2. System behavior

The `klin_dht_temp` sensor supplies the kiln temperature. ESP32 publishes readings about every 2 seconds and the backend evaluates the temperature when each reading arrives. The dashboard labels the automatic mode **PID Auto-Control**. The current control rule is:

| Kiln temperature | Kiln heater (`klin_heater`) | Heat blower (`heat_blower`) | Kiln motor (`klin`) |
|---|---|---|---|
| Below 35°C | ON | ON | OFF |
| 35°C or above | OFF | OFF | ON |

The setpoint is fixed at 35°C and is not adjustable in the dashboard. There is no hysteresis or delay around the setpoint; fluctuating readings near 35°C can cause repeated switching.

The preheating tower heater is a separate ESP32-2 relay actuator on channel 10. Its nearby sensor is `preheating_tower_dht_temp`. It is not controlled by the kiln's 35°C PID Auto-Control rule; use its dedicated control and the plant's approved operating conditions.

### Control priority and override behavior

| Control/mode | Operation and priority behavior |
|---|---|
| **MASTER ON / MASTER OFF** | Sends the selected state to all 13 relay actuators, including heaters, fans, motors, conveyors, and mills. It activates the Master override and pauses kiln temperature-based automation. |
| **Manual ON / OFF: `klin_heater`** | Sends a direct command to the kiln heater and enables its manual override. PID Auto-Control of both `klin_heater` and `heat_blower` is paused. |
| **Manual ON / OFF: `klin`** | Sends a direct command to the kiln motor and enables its separate manual override. PID Auto-Control of the kiln motor is paused. |
| **PID Auto-Control** | Applies the 35°C rule only when the Master override is inactive and the relevant manual override is cleared. It is the normal automatic mode and yields to active overrides. |

Master override pauses automation; it does not prevent a later individual manual command from being sent. That direct command can change the requested state of its actuator, but it does not clear the Master pause. A later Master command again commands every actuator. Either **Resume Auto PID** button on the Klin or Kiln Heater control clears the Master override and both kiln manual overrides, then immediately evaluates the latest available temperature. Pressing both buttons is not required.

## 3. Preconditions

Before operating the heater:

1. Confirm the operator is authorized and is following the plant's approved operating and isolation procedures.
2. Check that the backend and ESP2 are online.
3. Confirm `klin_dht_temp` is updating with plausible readings.
4. Check whether **Manual Override Active** is shown on the Klin or Kiln Heater control. Identify the intended control mode before issuing a command.
5. After any command, verify the reported actuator state. A sent-command notification or a highlighted widget button is not proof of physical relay operation.

## 4. Procedure A: PID Auto-Control

1. Open the plant dashboard and verify the ESP2 status and kiln temperature.
2. If Master or manual override is active, select **Resume Auto PID** on either the Klin or Kiln Heater control when it is appropriate to return both kiln branches to automatic control.
3. Observe the Kiln Temperature Monitor and reported states. Below 35°C, the heater and blower are requested ON and the kiln motor OFF. At or above 35°C, the heater and blower are requested OFF and the kiln motor ON.
4. Continue monitoring the temperature and actuator states during operation.

## 5. Procedure B: Dashboard manual control

1. On the dashboard, use the `klin_heater` ON or OFF control to issue a manual heater command. This also pauses automatic control of the heat blower; it does not directly issue a separate blower command.
2. For manual kiln heating, first issue **OFF** to `klin_heater` to engage its manual override and ensure the heater is off. Then turn `heat_blower` **ON** and verify its reported state before turning `klin_heater` **ON**. Keep the blower ON for the entire time the kiln heater is ON. The software does not enforce this sequence or interlock the heater with the blower.
3. To stop manual kiln heating, turn `klin_heater` **OFF** first. Keep the blower running as required by the plant's approved operating procedure; only turn it OFF when permitted by that procedure.
4. If needed, use the `klin` ON or OFF control to manually operate the kiln motor. Its manual override is separate from the heater override.
5. Confirm the requested states and check the **Manual Override Active** indicator.
6. To return both kiln branches to PID Auto-Control, select **Resume Auto PID** on either the Klin or Kiln Heater control. Confirm that the latest temperature rule is being applied.

## 6. Procedure C: Cupola widget control

### Cupola interactive widget

Use this single URL in Cupola for the interactive kiln-heater ON/OFF widget:

`http://10.10.12.65:4173/control.html?id=klin_heater`

1. Open the URL from Cupola on a device that can reach the plant network and widget host `10.10.12.65`.
2. The page displays interactive ON and OFF buttons for `klin_heater`. Opening the page alone does not issue a heater command.
3. Select ON or OFF inside the widget to send the command. The widget highlights the selected state, but it does not provide a Resume Auto control.
4. Verify the reported state in the dashboard. The command places the heater in manual override, which pauses PID Auto-Control of the heat blower too.
5. To resume PID Auto-Control, open the dashboard and use **Resume Auto PID** on either the Klin or Kiln Heater control.

The widget page is served on port `4173` and sends control requests to the backend on port `4000` using the same host name. Both services must be reachable. Use the exact host above only when that is the active Cupola/widget server address.

For manual kiln heating from the Cupola widget, apply the same blower-first operating requirement: use the dashboard to place `klin_heater` in manual mode with it OFF, switch `heat_blower` ON and verify it, then use the Cupola widget to turn `klin_heater` ON. Keep the blower ON while the heater is ON. The current `klin_heater` widget controls only the kiln heater; it does not turn the blower on automatically.

## 7. Procedure D: Preheating tower heater

### Control behavior

The preheating tower heater (`preheating_tower_heater`) is ESP32-2 relay channel 10. Its nearby temperature sensor is `preheating_tower_dht_temp`; the dashboard also displays the preheating tower humidity reading. This is separate equipment from the kiln heater and kiln heat blower.

The 35°C PID Auto-Control rule described in Section 2 applies only to `klin_heater`, `heat_blower`, and `klin`. The preheating tower temperature is displayed for monitoring and does not currently switch `preheating_tower_heater` automatically. There is no preheating-tower setpoint or Resume Auto PID control in this workflow; operate it using the dedicated manual ON/OFF control and the plant's approved temperature limits.

| Input/control | Effect on preheating tower heater |
|---|---|
| `preheating_tower_dht_temp` | Provides a temperature reading for monitoring; it does not automatically switch this heater. |
| Dashboard **Preheating Tower Heater** ON/OFF | Sends a manual command to relay channel 10. |
| Cupola widget with `id=preheating_tower_heater` | Sends ON/OFF when the operator selects a button in that widget. It is separate from the currently used `id=klin_heater` widget. |
| **MASTER ON / MASTER OFF** | Commands this heater along with all other relay actuators. |
| **Resume Auto PID** for Klin/Kiln Heater | Restores kiln control only; it does not apply a temperature rule to the preheating tower heater. |

### Operating procedure

1. Confirm the operator is authorized, ESP2 is online, and the preheating tower temperature reading is plausible and updating.
2. Confirm that the intended action is permitted by the plant's approved preheating-tower operating limits and procedures. Do not use the kiln's 35°C threshold as the preheating tower setpoint.
3. On the dashboard, use the dedicated **Preheating Tower Heater** ON or OFF control. Verify the reported actuator state after the command.
4. To operate it from Cupola, configure a separate interactive widget using `http://10.10.12.65:4173/control.html?id=preheating_tower_heater`. Opening the widget page alone does not issue a command; select ON or OFF inside the widget. The current `id=klin_heater` widget controls only the kiln heater.
5. After a Master ON/OFF command, verify this heater's state with the other commanded actuators. Returning the kiln controls to PID Auto-Control does not automatically change the preheating tower heater state.

## 8. Master switch procedure

1. Use **MASTER ON** or **MASTER OFF** only when intending to command all 13 relay actuators.
2. Be aware that the command pauses kiln temperature-based automation and activates the Master override.
3. After the Master command, verify the states of the equipment that the command was intended to affect.
4. When returning to kiln PID Auto-Control is intended, select **Resume Auto PID** on either the Klin or Kiln Heater control. This clears the Master override and both kiln manual overrides, and immediately reapplies the temperature rule.

## 9. Temperature monitor and baseline

The Kiln Temperature Monitor displays heater temperature change:

- **Starting Temp** is captured when the monitor observes the heater turn ON and no baseline is set.
- **After Heater Temp** is the latest kiln sensor reading received while the heater is ON.
- **Temp Gain (ΔT)** is the after-heater reading minus the starting reading.
- **Reset Baseline** clears the display values; it does not switch the heater or change the 35°C setpoint. If the heater is already ON, the next temperature update becomes the new starting reading.

The monitor data is live-only and held in backend memory. It is cleared when the backend restarts.

## 10. Abnormal conditions and safety

- If temperature is missing or implausible, or ESP2/backend is offline, do not assume automatic control or a command is operating correctly. Notify the responsible plant operator and follow local procedures.
- If readings fluctuate around 35°C, repeated switching may occur. Monitor the equipment and escalate if behavior is unexpected.
- Keep the Cupola widget and backend on the trusted plant network. Heater commands are sent when an operator selects ON or OFF in the widget.
- The software does not provide a validated over-temperature trip, independent safety interlock, or guaranteed fail-safe heater shutdown. Dashboard and widget states are not substitutes for physical inspection, approved safety controls, or equipment isolation procedures.